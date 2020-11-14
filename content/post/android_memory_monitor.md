---
title: "实时获取Android进程内存信息"
date: 2020-09-03T21:24:09+08:00
tags: [Android, Development]
draft: false
---

# 前言
我在干活过程中需要实时获取Android中`system_server`进程的内存信息。而在Android 10上实现对特定进程的内存监控时踩了几个坑，因此在此记录一下几个坑点和解决方案。



# Android获取内存信息的几种方式
参考文献[<sup>1</sup>](#refer-anchor-1)中给出了几种获取内存信息的方式：

1. 使用`ActivityManager`的`getMemoryInfo(ActivityManager.MemoryInfo outInfo)`

2. 使用`ActivityManager`的`MemoryInfo[] getProcessMemoryInfo(int[] pids)`

3. 使用`Debug`的`getMemoryInfo(Debug.MemoryInfo memoryInfo)`以及`getNativeHeapSize ()`、`getNativeHeapAllocatedSize ()、getNativeHeapFreeSize ()`
4. 使用`dumpsys meminfo`命令

5. 使用`adb shell procrank`命令
6. 使用`adb shell cat /proc/meminfo` 命令

在上述的几种方式中前4种可以获取到某一进程的详细内存信息，第5种方法可以获取到进程的内存总量相关的信息（Vss, Rss, Pss, Uss）而第6种方式只能获取系统的总体内存状态。由于我在干活时希望能够获取到系统进程的详细内存信息，并且因此仅考虑前4种方式。同时如果使用第4种方式，需要经过多次输出的解析，会带来额外的开销。



# 坑点
- 坑点1: Android10中方式1、2获取内存信息的采样率是5分钟，无法实时获取
- 坑点2: Android 10中普通应用程序仅能获取本进程的内存信息。
- 坑点3: 实时获取应用内存信息具有很大时间开销。



# 解决方案
- 对于坑点1，使用`Debug`的`getMemoryInfo(Debug.MemoryInfo memoryInfo)`方法获取进程的内存信息，方式4底层也是通过调用该方法获取应用内存信息的，对`dumpsys meminfo`的分析见参考文献[<sup>2-4</sup>](#refer-anchor-2)。
- 对于坑点2，使用`xposed`插桩需要获取内存信息的目标应用，在其中注册一个`BroadcastReceiver`，并启动一个`Service`用于数据交换。当用户程序需要获取目标应用的内存信息时，只需要通过`Service`发送一个广播请求，目标应用注册的`BroadcastReceiver`接收广播后调用`Debug.getMemoryInfo(Debug.MemoryInfo memoryInfo)`方法获取目标应用的内存信息，将该内存信息保存到`Service`中，进一步发送给用户程序。通过这样一个过程普通用户程序就可以获取到系统进程的内存信息。
- 对于坑点3，只能通过降低API的调用频率，或者仅获取部分内存信息（如仅获取PSS）来缓解。



# 参考文献
- [1] [CSDN-Android 如何获取App内存大小](https://blog.csdn.net/wangbaochu/article/details/45581875)<div id="refer-anchor-1"/>
- [2] [CSDN-dumpsys meminfo执行流程(一)](https://blog.csdn.net/zsj100213/article/details/78572383)<div id="refer-anchor-2"/>
- [3] [CSDN-dumpsys meminfo执行流程(二)](https://blog.csdn.net/zsj100213/article/details/78580501?utm_medium=distribute.pc_relevant.none-task-blog-title-1&spm=1001.2101.3001.4242)<div id="refer-anchor-3"/>
- [4] [CSDN-dumpsys meminfo执行流程(三)](https://blog.csdn.net/zsj100213/article/details/78597633?utm_medium=distribute.pc_relevant.none-task-blog-title-2&spm=1001.2101.3001.4242)<div id="refer-anchor-4"/>

