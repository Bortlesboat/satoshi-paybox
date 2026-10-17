set -e
mkdir -p ~/.local/node24
cd /tmp
V=v24.21.0
if ! curl -fsSL -o node24.tar.xz "https://nodejs.org/dist/$V/node-$V-linux-x64.tar.xz"; then
  V=$(curl -fsSL https://nodejs.org/dist/latest-v24.x/ | grep -o 'v24\.[0-9]*\.[0-9]*' | head -1)
  curl -fsSL -o node24.tar.xz "https://nodejs.org/dist/$V/node-$V-linux-x64.tar.xz"
fi
tar -xJf node24.tar.xz -C ~/.local/node24 --strip-components=1
export PATH=~/.local/node24/bin:$PATH
node --version
npm i -g pnpm@11.11.0 >/dev/null 2>&1
pnpm --version
which pnpm
