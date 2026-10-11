#!/usr/bin/env bash
# Boot a real x86_64 Linux in QEMU and run the sfx-gen installer inside it.
# No GUI needed: the guest console runs on this terminal over stdio.
#
#   scripts/qemu-linux-test.sh [img]
#
# First run downloads the Ubuntu 22.04 amd64 cloud image (~670 MB) unless given
# a path. You land at a login prompt (tester / tester) and run the installer
# yourself. Give it time,
# x86_64 on Apple Silicon is software emulation: boot ~2 min, sa3-generate a
# 1s probe clip can take 10+ min. The script prints timings as it goes.

set -euo pipefail

IMG="${1:-$HOME/.cache/qemu-test/jammy-server-cloudimg-amd64.img}"
DIR="$(cd "$(dirname "$IMG")" && pwd)"
SEED="$DIR/seed.img"
DISK="$DIR/test-disk.img"

command -v qemu-system-x86_64 >/dev/null || { echo "brew install qemu"; exit 1; }

BASE=https://cloud-images.ubuntu.com/jammy/current
if [ ! -f "$IMG" ]; then
  echo "downloading Ubuntu 22.04 amd64 cloud image (~670 MB)"
  mkdir -p "$DIR"
  curl -fL --retry 3 -o "$IMG" "$BASE/jammy-server-cloudimg-amd64.img"
fi
# direct-kernel boot; matches the image's own grub cmdline except ds=nocloud-net
if [ ! -f "$DIR/jammy-vmlinuz" ]; then
  curl -fL --retry 3 -o "$DIR/jammy-vmlinuz" "$BASE/unpacked/jammy-server-cloudimg-amd64-vmlinuz-generic"
  curl -fL --retry 3 -o "$DIR/jammy-initrd" "$BASE/unpacked/jammy-server-cloudimg-amd64-initrd-generic"
fi

# cloud-init config: served to the guest over user-mode NAT (ds=nocloud-net).
# Disk/ISO seeds are format-sensitive; the NoCloud HTTP datasource just works:
# QEMU's gateway 10.0.2.2 is the host, so we run a one-shot HTTP server on it.
cat > "$DIR/user-data" <<'YAML'
#cloud-config
ssh_pwauth: false
users:
  - name: tester
    plain_text_passwd: tester
    lock_passwd: false
    shell: /bin/bash
    sudo: ALL=(ALL) NOPASSWD:ALL
chpasswd:
  expire: false
YAML
cat > "$DIR/meta-data" <<'YAML'
instance-id: sfx-gen-qemu-test-1
local-hostname: testvm
YAML

# work on a copy, keep the pristine download
[ -f "$DISK" ] || { cp "$IMG" "$DISK"; qemu-img resize -f qcow2 "$DISK" 8G >/dev/null; }

echo "== booting x86_64 Linux (TCG emulation). login: tester / tester"
echo "== inside the guest, run:"
echo "   curl -fsSL https://raw.githubusercontent.com/nkapila6/sfx-gen/main/install.sh | sudo bash"
echo "== quit QEMU: Ctrl-A then X"
echo
# one-shot HTTP server on 10.0.2.2:8000 serving user-data/meta-data to the guest
python3 -m http.server 8000 --bind 10.0.2.2 --directory "$DIR" >/dev/null 2>&1 &
HTTPPID=$!
trap 'kill $HTTPPID 2>/dev/null' EXIT

qemu-system-x86_64 \
  -M q35 -accel tcg,thread=multi -cpu max -m 4G -smp 4 \
  -kernel "$DIR/jammy-vmlinuz" -initrd "$DIR/jammy-initrd" \
  -append "root=LABEL=cloudimg-rootfs ro console=tty1 console=ttyS0 ds=nocloud-net;s=http://10.0.2.2:8000/" \
  -drive "file=$DISK,format=qcow2,if=virtio" \
  -nic user,model=virtio-net-pci \
  -nographic

kill $HTTPPID 2>/dev/null
