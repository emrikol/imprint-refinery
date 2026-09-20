# Third-party notices

Imprint Refinery is licensed under `GPL-2.0-or-later`. The following bundled
components and data retain their own licenses.

Imprint Refinery's compiled frontend contains Lit, Lit HTML, Lit Element,
`@lit/reactive-element`, and `@lit-labs/ssr-dom-shim`. These packages are
distributed under the BSD 3-Clause License:

> Copyright (c) 2017 Google LLC. All rights reserved.
>
> Redistribution and use in source and binary forms, with or without
> modification, are permitted provided that the following conditions are met:
>
> 1. Redistributions of source code must retain the above copyright notice,
>    this list of conditions and the following disclaimer.
>
> 2. Redistributions in binary form must reproduce the above copyright notice,
>    this list of conditions and the following disclaimer in the documentation
>    and/or other materials provided with the distribution.
>
> 3. Neither the name of the copyright holder nor the names of its contributors
>    may be used to endorse or promote products derived from this software
>    without specific prior written permission.
>
> THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
> AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
> IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
> ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
> LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
> CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
> SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
> INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
> CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
> ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
> POSSIBILITY OF SUCH DAMAGE.

The bundled offline remote catalog is derived from
[Flipper-IRDB](https://github.com/Lucaslhm/Flipper-IRDB) at the revision pinned
in [`catalog-sources.json`](catalog-sources.json). Flipper-IRDB is dedicated to
the public domain under CC0-1.0. The exact license text and source metadata are
embedded in `catalog-v1.ircat`; see [Offline catalog](docs/OFFLINE-CATALOG.md)
for the reproducible-build and integrity policy.

Development-only tools and their declared licenses remain enumerated in
`package-lock.json`; they are not shipped as part of the Home Assistant custom
component.
