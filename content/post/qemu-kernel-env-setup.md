---
title: "Qemu Busybox Kernel环境搭建小记"
date: 2020-11-13 22:04:00+0800
lastmod: 2020-11-13 22:04:00+0800
tags: ["Kernel", "Qemu"]
draft: false
---

## 前言
本文目的是搭建一个Linxu Kernel的调试环境，所需要用到的工具分别有Qemu和Busybox。其中Qemu是一个强大的cpu模拟器，它可以模拟各种主流cpu的执行，同时还提供了很多便利的功能。Busybox是一个集成了众多Unix工具的精简工具集，比较适合在如嵌入式系统这样的环境下使用。本文将记录一次Kernel构建，Busybox构建，Qemu安装，模拟器运行的过程

## Kernel构建

首先获取Linux的git仓库，如果知道自己想获取的分支版本，则可以使用-b指定。如果想要获取某一个特定commit的内核版本而不想要其他git内容，则可以前往`https://github.com/<repo_name>/tree/<commit_sha>`通过Download Zip下载源码包。比如想要下载linux `5805992184f97b7797f24b74d511825f8992861e`这个commit的代码树，则可以前往`https://github.com/torvalds/linux/tree/5805992184f97b7797f24b74d511825f8992861e`下载。
```bash
# Get Full Repo
git clone https://github.com/torvalds/linux.git
# Get Specific Branch
git clone -b v4.14 https://github.com/torvalds/linux.git
```
在构建linux image前需要用Kconfig对Linux进行配置，Linux内核会提供一些config选择，比如默认可以使用x86_defconfig，这些可选的config可以通过`make help`看到。当选择好使用什么config时可以使用`make $(CONFIG_NAME)`进行配置。也可以使用`make menuconfig`进行菜单配置或是直接修改`.config`。

在配置完成后，就可以使用make来进行内核构建了。这部分可能会遇到很多问题，当遇到编译问题时可以上网搜索，或是检查自己编译器的类型(gcc/clang)或是版本是否满足对应版本内核的编译需求。使用交叉编译的话需要提前将交叉编译工具链加入环境变量`PATH`中。
```bash
# An example for making linux image
make -j16
```

编译完成后通常可以在`arch/$ARCH/boot`中找到编译得到的image，默认是`bzImage`。

## Busybox构建

Busybox的源代码可以从[其官网](https://busybox.net)下载。由于Busybox和Linux一样也使用了Kbuild/Kconfig来进行配置管理，所以其编译过程是类似的。
```bash
# An example for making busybox image
make menuconf
make -j16 && make install
```
在上面的`make menuconfig`中要注意勾选`Build static binary (no shared libs)`选项，来在构建过程中国呢使用静态链接而非动态链接。该选项位于`Settings`中的`Build Options`下。

构建完成后在`_install`目录下能够看到一系列的文件夹，这是我们后续创建文件系统的基础。

## Qemu安装

直接安装qemu就可以使用。但是为了加速或是调试kvm相关的内核功能，可能需要使用到qemu-kvm。

```bash
sudo apt-get update
sudo apt-get install -y qemu-kvm qemu
# （可选）也可以使用Virt-Manager来管理kvm虚拟机
sudo apt-get install virt-manager virt-viewer libvirt-bin
```

## Qemu启动

为了让内核成功启动，还需要为其创建一个初始化的文件系统。最简单的方法是使用mkinitramfs。
```bash
mkinitramfs -o initrd.img
```
通过这种方式创建的文件系统包含了基本的目录和可执行程序。但是这样创建的文件系统可以用的程序太少了，而且无法自定义文件系统中的其他内容。所以下面使用`cpio`自建文件系统。

首先在之前构建好的busybox安装目录中创建必要的文件夹
```bash
cd $BUSYBOX_SOURCE_DIR/_install
mkdir -p proc etc sys
# bin linuxrc sbin usr usr/bin usr/sbin这几个目录在_install目录下都已经创建了
```
然后可以创建init文件，写入开机启动脚本：
```bash
# 使用普通用户权限
setsid /bin/cttyhack setuidgid 1000 /bin/sh
# exec /bin/sh # 使用root权限
```
将以下内容写入`etc/inittab`
```bash
::sysinit:/etc/init.d/rcS
::askfirst:/bin/sh
::ctrlaltdel:/sbin/reboot
::shutdown:/sbin/swapoff -a
::shutdown:/bin/umount -a -r
::restart:/sbin/init
```
创建`etc/init.d/rcS`，并且给它可执行权限`chmod +x etc/init.d/rcS`
```bash
#!/bin/sh
mkdir /tmp
mount -t proc none /proc
mount -t sysfs none /sys
mount -t debugfs none /sys/kernel/debug
mount -t tmpfs none /tmp
mount -n -t tmpfs none /dev
mknod -m 622 /dev/console c 5 1
mknod -m 666 /dev/null c 1 3
mknod -m 666 /dev/zero c 1 5
mknod -m 666 /dev/ptmx c 5 2
mknod -m 666 /dev/tty c 5 0 # <--
mknod -m 666 /dev/ttyS0 c 4 64
mknod -m 444 /dev/random c 1 8
mknod -m 444 /dev/urandom c 1 9
mdev -s
```

在_install目录中放入其他想放的文件后就可以打包文件系统镜像了。

```bash
cd $BUSYBOX_SOURCE_DIR/_install
find . | cpio -o --format=newc > ../initrd.img
```

有了文件系统就可以用qemu启动内核了
```bash
qemu-system-x86_64 -kernel arch/x86_64/boot/bzImage -nographic -append "console=ttyS0" -initrd initrd.img -m 128
```
稍微解释一下几个参数，`-kernel`参数指定系统镜像，`-nographic`表示在纯命令行运行和`"console=ttyS0"`一起使用使用启动界面作为终端，`-append`指定了传给linux kernel的参数，`-initrd`指定了初始化文件系统，`-m`指定了内存大小(MB)。还可以使用`-S`开启gdb调试，用`-s`来在1234端口监听gdb（相当于`-gdb tcp::1234`）。

## 总结

简单记录了搭建一些kernel调试环境的过程。环境搭建其实是一件比较烦人的事情。
