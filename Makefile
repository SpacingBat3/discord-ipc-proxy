# Node.js binary
NODE ?= node
# TypeScript compiler
TSC ?= node_modules/.bin/tsc
# Rollup toolkit
ROLLUP ?= node_modules/.bin/rollup
# Postject binary
POSTJECT ?= node_modules/.bin/postject
# Postject args
POSTJECTARGS += --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2

# Signature removal tool with args
SIGRM = true
# Tool to sign resulting binary
SIGTOOL = 

# Mandatory binary extension
BINEXT =

# Path to Node.js
NODEPATH := $(shell $(NODE) -e "console.log(process.execPath)")

ifeq ($(OS),Windows_NT)
	SIGRM = signtool remove /s
	BINEXT = .exe
else
	OS ?= $(shell uname -s)
	ifeq ($(OS),Darwin)
		SIGTOOL = codesign --sign -
		SIGRM = codesign --remove-signature
		POSTJECTARGS += --macho-segment-name NODE_SEA
	endif
endif

all: build

clean:
	rm bin/bin/discord-ipc-proxy$(BINEXT) cache/sea.bin dist/bundle.js dist/index.js
	rmdir bin

build: bin/discord-ipc-proxy$(BINEXT)

dist/index.js:
	@echo Compiling package sources...
	@$(TSC)

dist/bundle.js: dist/index.js
	@echo Bundling package sources...
	@$(ROLLUP) dist/index.js --file dist/bundle.js --format iife

cache/sea.blob: dist/bundle.js
	@echo Generating SEA blob...
	@mkdir -p cache
	@$(NODE) --experimental-sea-config sea-config.json

bin/discord-ipc-proxy$(BINEXT): cache/sea.blob
	@echo Bundling final executable...
	@mkdir -p bin
	@cp $(NODEPATH) bin/discord-ipc-proxy$(BINEXT)
	@$(SIGRM) bin/discord-ipc-proxy$(BINEXT)
	@$(POSTJECT) bin/discord-ipc-proxy$(BINEXT) NODE_SEA_BLOB cache/sea.blob $(POSTJECTARGS)
