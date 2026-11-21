# Third-party notices / 第三方组件声明

个人科研工程工作台 • Windows x64 • 4.0.0-rc.1

请随程序再分发保留本声明、便携目录的 `LICENSE`、`LICENSES.chromium.html` 和图谱库内的版权注释。下列相对路径以解压后的程序目录为起点。

| 随包组件 | 版本与用途 | 许可与声明位置 |
| --- | --- | --- |
| Electron | 32.2.0，Windows x64 窗口与主进程 | MIT；根目录 `LICENSE` 为完整原文 |
| Chromium、V8、Node.js | Chromium 128.0.6613.178、V8 12.8.374.36-electron.0、Node.js 20.18.0；Electron 内置 | Chromium 及 V8 的 BSD 系许可、Node.js 的 MIT 与各自内嵌组件条款以根目录 `LICENSES.chromium.html` 各条目为准 |
| 媒体、字体、图形与国际化组件 | FFmpeg、ANGLE、SwiftShader、Vulkan Loader、ICU 74.2 等由上述 Electron 构建携带 | 同一 HTML 汇编含 399 个上游条目，包括 FFmpeg、Node.js、V8、ANGLE、SwiftShader、Vulkan、ICU 的条款；编解码器及各依赖分别适用各自许可 |
| Cytoscape.js | 3.35.0，科研知识图谱及 CoSE 力导向布局 | MIT；源文件 `resources/app/assets/vendor/cytoscape.min.js` 含原始许可及嵌入代码署名 |
| Cytoscape.js 内嵌辅助代码 | Lodash 的 debounce/get/set/toPath 等、Heap；上游 3.35.0 构建声明的范围为 Lodash ^4.17.21、Heap ^0.2.7 | 两项 MIT；下列原文取自这两个范围的基准发布包。它们随 Cytoscape.js 一起编译，无单独可切换的运行版本 |
| Cytoscape.js 内嵌动画与 Promise 代码 | Promises/A+ Thenable 1.1.1、Bezier curve generator、Runge–Kutta spring physics | MIT；文件内署名抄列于下 |

Electron 的 npm 下载器与其传递依赖见源码的 `desktop/package-lock.json`。构建使用的 Node/npm、测试驱动和 Windows 资源编辑器属于开发环境。用户已有的 Codex CLI、RPM 环境和科研软件各按原安装渠道提供。工作台 Markdown 预览使用应用源码实现。

上游项目链接：[Electron 32.2.0](https://github.com/electron/electron/releases/tag/v32.2.0) · [Node.js 20.18.0](https://github.com/nodejs/node/tree/v20.18.0) · [Cytoscape.js 3.35.0](https://www.npmjs.com/package/cytoscape/v/3.35.0) · [Lodash](https://github.com/lodash/lodash) · [Heap](https://github.com/qiao/heap.js)。

## Cytoscape.js

Copyright (c) 2016-2026, The Cytoscape Consortium.

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the “Software”), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

### Notices preserved in the Cytoscape.js bundle

- Embeddable Minimum Strictly-Compliant Promises/A+ 1.1.1 Thenable. Copyright (c) 2013-2014 Ralf S. Engelschall. Licensed under The MIT License.
- Bezier curve function generator. Copyright 2014-2026 Gaetan Renaudeau. MIT License.
- Runge-Kutta spring physics function generator. Adapted from Framer.js, copyright Koen Bok. MIT License.

## lodash

```text
Copyright OpenJS Foundation and other contributors <https://openjsf.org/>

Based on Underscore.js, copyright Jeremy Ashkenas,
DocumentCloud and Investigative Reporters & Editors <http://underscorejs.org/>

This software consists of voluntary contributions made by many
individuals. For exact contribution history, see the revision history
available at https://github.com/lodash/lodash

The following license applies to all parts of this software except as
documented below:

====

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

====

Copyright and related rights for sample code are waived via CC0. Sample
code is defined as all source code displayed within the prose of the
documentation.

CC0: http://creativecommons.org/publicdomain/zero/1.0/

====

Files located in the node_modules and vendor directories are externally
maintained libraries used by this software which have their own
licenses; we recommend you read them, as their terms may differ from the
terms above.
```

## heap

```text
The MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```
