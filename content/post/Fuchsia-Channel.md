---
title: "Fuchsia 的进程间通信"
date: 2021-06-14T21:26:36+08:00
lastmod: 2021-06-14T21:26:36+08:00
tags: [Kernel]
draft: false
---

# Fuchsia 的进程间通信

## 引言

Fuchsia是Google推出的一种微内核系统，专门为设备互联的场景设计。在Fuchsia系统内，component是最小执行单元，几乎所有的应用、系统服务乃至驱动都作为component运行。可想而知，在系统运行过程中有大量的进程运行，并且会存在大量的进程间通信。因此这篇文章想从kernel源代码层面分析一下Fuchsia的底层进程间通信是如何运作的。

## Channel

Fuchsia底层使用channel来完成进程间的通信。Channel实际上是一个双工的消息管道，它属于Zircon（Fuchsia的内核）的内核对象，用户可以通过channel的handle（用户持有的对内核对象的引用）从channel的一端向另一端发送消息或从channel的一端接收另一端的消息。

Channel在Zircon内核中作为`ChannelDispatcher`对象存储，包含以下字段

```cpp
class ChannelDispatcher final
    : public PeeredDispatcher<ChannelDispatcher, ZX_DEFAULT_CHANNEL_RIGHTS> {
  // ...
  // 用于存储消息列表
  MessageList messages_ TA_GUARDED(get_lock());

  // 记录消息列表长度的历史最大值
  uint64_t max_message_count_ TA_GUARDED(get_lock()) = 0;

  // 用于追踪能够调用（比如write）这个channel的进程
  zx_koid_t owner_ TA_GUARDED(get_lock()) = ZX_KOID_INVALID;

  // 上一个事务ID（transaction id），用于分配新的无冲突txid，txid用于将写入的message
  // 和MessageWaiter对应上
  uint32_t txid_ TA_GUARDED(get_lock()) = 0;

  // channel中waiter的列表，waiter用于异步等待
  WaiterList waiters_ TA_GUARDED(get_lock());
};
```

与channel相关的系统调用有如下几个：

- `zx_channel_create()`: 创建一个新的channel
- `zx_channel_write()`: 向channel写入一个消息
- `zx_channel_read()`: 从channel中读取一个消息
- `zx_channel_call()`: 异步地发送消息和接受回复
- `zx_object_wait_one()`: 等待内核对象的信号

下文将结合代码对这几个系统调用进行简单分析。

### 创建Channel

普通进程可以通过`zx_channel_create()`这个系统调用创建一个channel，这个过程比较简单，主要就是创建两个相互独立的`ChannelDispatcher`，并将它们相互绑定为peer。在创建之前会根据policy进行检查：

```cpp
// sys_channel_create()
  auto up = ProcessDispatcher::GetCurrent();
  zx_status_t res = up->EnforceBasicPolicy(ZX_POL_NEW_CHANNEL);
  if (res != ZX_OK)
    return res;
```

### 写入Channel

在创建channel后，进程可以通过`zx_channel_write()`系统调用向channel中写入message，其代码如下。其流程简单来说就是通过`MessagePacket::Create()`创建`MessagePacket`对象，并将用户数据和用户的handle存储到`MessagePacket`中，在创建过程中内核会限制`MessagePacket`中字节的长度小于`kMaxMessageSize`(65536)，handle的数量小于`kMaxMessageHandles`(64)。创建完成后会调用`ChannelDispatcher::Write()`来将message发送给peer，即channel的另一端，在此过程中会校验channel的`owner`是否是当前进程，以及peer是否未被关闭。发送message是通过调用peer的`ChannelDispatcher::WriteSelf()`来实现的。

这个函数主要有两部分处理逻辑。第一部分代码是检查是否有waiter正在等待这一消息，如果存在则立即将消息交给waiter处理；第二部分代码则是将消息压入消息列表中。

如下所示的第一部分代码实际上处理了后面要提到的`sys_channel_call()`这类异步的channel通信机制。在通信过程中内核使用`MessageWaiter`来处理channel中的的异步消息，为了让`ChannelDispatcher`知道哪一个`MessageWaiter`和哪一个`MessagePacket`相对应，内核使用一个`txid`来唯一表示异步通信的transaction（事务）。所以代码判断是否有具有相同`txid`的waiter正在等待正要写入`msg`，如果有责将waiter从等待列表中移出，并调用`waiter.Deliver()`进行消息分发。

```cpp
// ChannelDispatcher::WriteSelf() part1
  if (!waiters_.is_empty()) {
    zx_txid_t txid = msg->get_txid();
    for (auto& waiter : waiters_) {
      if (waiter.get_txid() == txid) {
        waiters_.erase(waiter);
        waiter.Deliver(ktl::move(msg));
        return;
      }
    }
  }
```

第二部分代码将消息压入消息列表中。这里目前的fuchsia采用了一个临时的fix来限制消息列表的长度不超过`kMaxPendingMessageCount`(目前是3500)，当消息列表长度超过了这个限制，那么内核会向当前进程发送一个`ZX_EXCP_POLICY_CODE_CHANNEL_FULL_WRITE` signal，这是一个“architecture exception”，如果进程未对这个signal进行处理，那么进程会退出。
在写完之后内核通过`UpdateStateLocked()`更新state为可读状态。值得一提的是在创建

```
// ChannelDispatcher::WriteSelf() part2
  messages_.push_back(ktl::move(msg));
  if (messages_.size() > max_message_count_) {
    max_message_count_ = messages_.size();
  }

  if (messages_.size() == kMaxPendingMessageCount / 2) {
    auto process = ProcessDispatcher::GetCurrent();
    char pname[ZX_MAX_NAME_LEN];
    process->get_name(pname);
    printf("KERN: warning! channel (%zu) has %zu messages (%s) (write).\n", get_koid(),
           messages_.size(), pname);
  } else if (messages_.size() > kMaxPendingMessageCount) {
    auto process = ProcessDispatcher::GetCurrent();
    char pname[ZX_MAX_NAME_LEN];
    process->get_name(pname);
    printf("KERN: channel (%zu) has %zu messages (%s) (write). Raising exception\n", get_koid(),
           messages_.size(), pname);
    Thread::Current::SignalPolicyException(ZX_EXCP_POLICY_CODE_CHANNEL_FULL_WRITE, 0u);
    kcounter_add(channel_full, 1);
  }

  UpdateStateLocked(0u, ZX_CHANNEL_READABLE);
```

### 读取Channel

进程可以调用`zx_channel_read()`读取消息。如果`ChannelDispatcher`的消息列表为空，那么有两种情况，一种是peer已经关闭，另一种是peer未关闭但是无消息，根据这两种情况分别返回失败状态`ZX_ERR_PEER_CLOSED`和`ZX_ERR_SHOULD_WAIT`。如果消息列表中有数据，则判断message的size和handle数量是否超过用户要读取的长度，如果超过则返回错误状态。如果一切正常，则拷贝message的数据和handle到用户buffer中，并将字节数和handle数量更新到用户buffer中，在读取之后若消息列表为空，则内核通过`UpdateStateLocked`更新state为不可读状态。

### 调用channel

Zircon提供了`zx_channel_call()`系统调用来发送一次消息并且等待消息相应。它相当于调用`zx_channel_write()` `zx_object_wait_one()`和`zx_channel_read()`

```cpp
__EXPORT zx_status_t _zx_channel_call(zx_handle_t handle, uint32_t options, zx_time_t deadline,
                                      const zx_channel_call_args_t* args, uint32_t* actual_bytes,
                                      uint32_t* actual_handles) {
  zx_status_t status = SYSCALL_zx_channel_call_noretry(handle, options, deadline, args,
                                                       actual_bytes, actual_handles);
  while (unlikely(status == ZX_ERR_INTERNAL_INTR_RETRY)) {
    status = SYSCALL_zx_channel_call_finish(deadline, args, actual_bytes, actual_handles);
  }
  return status;
}
```

`zx_channel_call_noretry()`会将用户输入包装到`MessagePacket`中，然后调用`ChannelDispatcher::Call()`来处理。`ChannelDispatcher::Call()`会首先检查函数是否被重入，因为重入会导致channel call的状态异常。

```cpp
// zx_channel_call_noretry()->ChannelDispatcher::Call()
if (unlikely(waiter->BeginWait(fbl::RefPtr(this)) != ZX_OK)) {
    // If a thread tries BeginWait'ing twice, the VDSO contract around retrying
    // channel calls has been violated.  Shoot the misbehaving process.
    ProcessDispatcher::GetCurrent()->Kill(ZX_TASK_RETCODE_VDSO_KILL);
    return ZX_ERR_BAD_STATE;
  }
```
接着会检查channel的owner以及peer是否关闭。之后channel会为线程对应的waiter和msg设置一个txid以方便构造reply和waiter处理reply。

```cpp
// zx_channel_call_noretry()->ChannelDispatcher::Call()
  alloc_txid:
    zx_txid_t txid = (++txid_) | 0x80000000;
    for (auto& waiter : waiters_) {
      if (waiter.get_txid() == txid) {
        goto alloc_txid;
      }
    }
```

接着dispatcher依次将waiter压入waiter列表中和调用`ChannelDispatcher::WriteSelf()`将msg写入peer的消息列表中。最终系统调用将调用`ChannelDispatcher::ResumeInterruptedCall()`等待消息直至收到消息、等待超时或是被中断。

```cpp
// zx_channel_call_noretry()->
zx_status_t ChannelDispatcher::ResumeInterruptedCall(MessageWaiter* waiter,
                                                     const Deadline& deadline,
                                                     MessagePacketPtr* reply) {
  canary_.Assert();
  {
    ThreadDispatcher::AutoBlocked by(ThreadDispatcher::Blocked::CHANNEL);
    zx_status_t status = waiter->Wait(deadline);
    if (status == ZX_ERR_INTERNAL_INTR_RETRY) {
      // 如果被中断，返回但是不清除waiter
      return status;
    }
  }

  {
    Guard<Mutex> guard{get_lock()};

    // 如果等到消息，则消息被写入reply中
    zx_status_t status = waiter->EndWait(reply);
    // 在一些其他情况下waiter可能已经接收到message并被删除，此时status不为
    // ZX_ERR_TIMED_OUT，而如果超时需要在这移出waiter。
    if (status == ZX_ERR_TIMED_OUT)
      waiters_.erase(*waiter);
    return status;
  }
}
```

从上述代码我们可以知道在等待消息的时候系统调用有可能被中断返回`ZX_ERR_INTERNAL_INTR_RETRY`，为处理这种情况，系统会调用`zx_channel_call_finish()`，该函数主要也是调用`ChannelDispatcher::ResumeInterruptedCall()`等待消息。无论是`zx_channel_call_noretry()`还是`zx_channel_call_finish()`在收到reply后都会将消息写回用户空间。至此一次消息的同步发送接收就完成了。

## 小结

本文简单地分析了Fuchsia内核中的进程间通信机制 —— channel。在阅读源代码时我们可以发现，handle是Zircon内核与用户沟通的桥梁，内核不会关注进程间通信的双方分别是谁，而只关注进程持有的handle是否允许进程对内核对象进行读写，以及读写操作本身。事实上Zircon的channel机制只是为进程间通信提供了一个最基本的手段，component间通信的访问控制还需要系统框架层的支持。

此外channel机制有一个问题是当写入的消息多于读出的消息时，pending message数量会增加，从而消息列表会增长。如果对message列表长度不加限制会耗尽内核的内存资源。虽然Google通过设定了一个消息列表长度上限临时解决了这个问题，但是极端情况下每一个channel还是可以占用`3500*65536`字节，约为220MB的内存，如果一个进程创建了多个channel，那么它还是可以占用大量的系统资源。
