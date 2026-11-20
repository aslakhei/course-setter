# Third-party notices

Course-setter is licensed under the AGPL-3.0 (see LICENSE). It includes material from the projects below
under their own licences.

## Purple Pen: control description symbols

The drawings of the IOF control description symbols (`packages/core/src/descriptions/symbols.data.ts`) are
converted from the symbol database of Purple Pen (https://github.com/petergolde/PurplePen,
`src/PurplePenCore/symbols.xml`). Course-setter is not endorsed by Purple Pen or its author.

```
Copyright (c) 2006-2008, Peter Golde
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice,
   this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.
3. Neither the name of Peter Golde, nor "Purple Pen", nor the names of its
   contributors may be used to endorse or promote products derived from this
   software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## Liberation Sans

`packages/core/fonts/LiberationSans-Regular.ttf` and `LiberationSans-Bold.ttf` (Liberation Fonts
2.1.5, metric-compatible with Arial) are embedded in exported PDFs for control numbers and description
sheets, and used by the snapshot tests so they draw the same text on every platform. They are licensed
under the SIL Open Font License 1.1, see `packages/core/fonts/LICENSE-LiberationSans.txt`.
