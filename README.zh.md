# litearea

[English](README.md) | 中文

**一个架在原生 `<textarea>` 上的代码编辑器：能用的撤销/重做、由你自己写规则的高亮、VSCode 形状的补全 —— 且没有任何运行时依赖。**

`@citisen/litearea` 是一个库，不是一个插件。它不注册任何界面插槽、不读设置命名空间、也不知道 favicon 是什么。它是一个小引擎：把一段文本和一个 grammar 变成 token、诊断、装饰和候选列表；外加一层很薄的 DOM，把这一切放在一个真实的 textarea 后面。React 绑定是可选的，而且是单独的入口。

真正值得说的是它**不做**什么：它不持有文本。文本属于 textarea，由浏览器的编辑管线修改，库只负责读。

## 为什么

这个库出自两个 DeepSeek Harness 插件 —— `dsh-font` 和 `dsh-sentry`。两个插件各带一门小 DSL，也各自在 textarea 上手搓了一个编辑器。两者坏在了同样的三个地方：

- 补全列表像在跟打字的人较劲；
- 一旦接受了某条建议，Ctrl+Z 就失效了；
- 在行中间编辑时，光标会跳到末尾。

这不是三个 bug，而是一个 bug 的三张脸：文本存在组件状态里，每次按键都被写回 textarea，然后被**读三遍** —— 一遍上色、一遍诊断、一遍出建议 —— 三个互不相干的通道，当然可以互相矛盾。

用脚本给 textarea 的 `value` 赋值不是一次编辑。它替换元素的内容，顺带扔掉浏览器的撤销栈，并把选区重置到末尾。就是这一行同时造成了"撤销没了"和"光标乱跳"。第三个症状来自那三遍读取：一个词可能被上色成合法取值，同时补全器认为它不认识，而波浪线指向一个早就移动过的区间。

所以这个库在每一个点上都做了相反的选择，而且每一条都是承重的：

- **撤销和重做活着，因为文本归 DOM 所有。** 输入框只在构造时被写入一次，那时还监听器都还没有。库代替用户做的每一次修改都走 `document.execCommand('insertText')`，于是浏览器把它记进自己的撤销栈 —— 一次编辑，用浏览器自己的 Ctrl+Z 就能撤。这里刻意**没有**替代 API：合成的 `input` 事件是不可信的，浏览器不会让它走编辑管线；而 `setRangeText` 能改文本，但完全绕过历史记录。
- **光标不动，因为没有任何东西重写它下面的文本。** 上色层只读输入框，从不写它。唯一会写选区的，是补全自己要求的那几次 `setSelectionRange`。
- **一段文本只解析一次。** `inspect(text, grammar)` 跑一遍，上色、波浪线、语义标记、候选列表、悬浮提示读的都是同一个值。它们不可能互相漂移，因为根本没有第二个来源。

## 安装

```sh
npm install @citisen/litearea
```

三个入口：

| 导入 | 是什么 |
| --- | --- |
| `@citisen/litearea` | 纯引擎加上 DOM 层（`createEditor`、`LiteArea`） |
| `@citisen/litearea/react` | React 绑定（`LiteAreaEditor`） |
| `@citisen/litearea/styles.css` | 编辑器自己注入的那份样式表，给想用 `<link>` 的宿主 |

没有 grammar 入口。这个库一点语法都不带 —— 规则由调用方提供 —— `src/core/` 里也不导入任何语言。

React 是可选的 peer 依赖（`react >= 18`），也是唯一的 peer 依赖。这个包没有任何运行时依赖。样式表在第一个编辑器创建时注入文档一次，除非传 `injectStyles: false`。

## 快速开始

原生用法，grammar 短到可以一口气读完：

```ts
import { createEditor, defineGrammar, defineVocabulary } from '@citisen/litearea'

// 一个 vocabulary 一次声明完一组封闭词汇需要的四件事 —— 词表、上色用的
// scope、非成员拿到的消息、悬浮时显示的文档 —— 所以它们没有机会各自漂移。
const COLORS = defineVocabulary({
  id: 'color',
  words: ['red', 'green', 'blue'],
  unknownMessage: '"{word}" is not a colour — expected {allowed}.',
  docs: { red: 'The default swatch.' },
})

const grammar = defineGrammar({
  id: 'swatch',
  // 每个位置都按顺序试规则，第一个命中的赢。
  rules: [
    { kind: 'match', scope: 'comment', pattern: /#[^\n]*/ },
    { kind: 'words', words: COLORS, unknown: {} },
  ],
  compose: [
    {
      id: 'color',
      range: (context) => context.word,
      items: () =>
        ['red', 'green', 'blue'].map((color) => ({ label: color, kind: 'color' })),
    },
  ],
})

const editor = createEditor(document.querySelector('#editor')!, {
  grammar,
  value: 'red  # a comment',
  placeholder: 'red, green, blue',
  onChange: (value) => {
    // 只报告用户自己的编辑。库自己做的写入 —— 补全，或者下面的 setValue ——
    // 在动手之前就被标记过，不会回传给调用方。
    console.log(value)
  },
})

// 宿主主动写入。`true` 表示这是一次可撤销的编辑，Ctrl+Z 能把旧文本拿回来；
// 默认是直接赋值，会清掉历史记录。
editor.setValue('green', true)
```

React，复用同一个 `grammar` 对象：

```tsx
import * as React from 'react'
import type { LiteArea } from '@citisen/litearea'
import { LiteAreaEditor } from '@citisen/litearea/react'
import { grammar } from './swatch-grammar'

export function SwatchEditor() {
  const [text, setText] = React.useState('')
  const editorRef = React.useRef<LiteArea | null>(null)

  return (
    <>
      <LiteAreaEditor
        grammar={grammar}
        defaultValue="red  # a comment"
        onChange={setText}
        sizing={{ minRows: 2, maxRows: 10 }}
        editorRef={(editor) => {
          editorRef.current = editor ?? null
        }}
      />
      <button type="button" onClick={() => editorRef.current?.undo()}>
        Undo
      </button>
      <pre>{text}</pre>
    </>
  )
}
```

`LiteAreaEditor` 只渲染一个空 `div`，把命令式的编辑器挂进去。它**不**让文本经过 React，原因见[为什么](#为什么)：那正是毁掉撤销的做法。初始文本用 `defaultValue`；`value` 是给"宿主想写入文本"的场景（重置按钮、切换文档）准备的，它走编辑管线所以仍然可以撤销，而且它不会触发 `onChange` —— 调用方自己知道刚写了什么。

## 它做了什么

| 能力 | 背后的机制 |
| --- | --- |
| 撤销与重做 | 输入框只在构造时写入一次；库的每次修改都走 `execCommand('insertText')`，由浏览器自己的历史记录记下来 |
| 光标不跳 | 没有任何东西重写光标下的文本；唯一写选区的地方是补全要求的那几次 |
| 自定义高亮 | `rules` 给文本刷 scope；一个 scope 变成类名 `litearea-scope-<scope>`，长什么样由样式表决定。核心不含任何语法 |
| 补全 | 每次过滤都从光标重新计算替换区间、分档的模糊排序、文档面板、提交字符，以及不会让输入框失焦的鼠标点选 |
| 诊断 | vocabulary 的拒绝、声明式 `checks`、`validate` 钩子，合并去重后按四种严重级别画波浪线 |
| 悬浮提示 | `resolveHover`：诊断优先于一切；否则 decoration 的标题会和 grammar 自己的 `describe` 一起显示 |
| 语义标记 | `decorate` 返回的区间刻意不是 token，画成 `litearea-dec-<kind>`，重算时不需要重新词法分析 |
| 吸顶的块头 | `sticky.kinds` 点名的 decoration 种类即为「块」；读者身处哪个块，就把那个块的头一行复制到框顶，每嵌套一层多堆一行 |
| 内联补全预览 | 开了 `completion.inline` 后，当前行里「还没打出来的那部分」会作为一个不透明小片，画在下一个字符将要落下的位置 |
| 打字辅助 | grammar 的 `pairs` 会自己闭合、跨过自己插入的右半边、把选中内容包起来；`comments` 驱动注释切换；在一对括号之间按回车会开出一个缩进块。这些修改全部走浏览器的编辑管线，所以一次 Ctrl+Z 就能整体撤回 |
| 自动高度 | 量的是离屏 mirror，不是活的输入框；写回高度和 overflow，并把量到的滚动条宽度发布给上色层 |
| 一段文本一次解析 | `inspect` 一次性产出 token、诊断、装饰和分析结果，并按文本缓存；文本和分析都没变时直接跳过重绘 |
| 键盘与无障碍 | `role="combobox"`、`aria-expanded`、`aria-activedescendant`、`aria-invalid`、`aria-label`，以及带真实行 id 的 listbox |
| 体积 | 没有运行时依赖，没有 CodeMirror，没有 Monaco，引擎里没有虚拟 DOM |

## 写一个 grammar

一个 grammar 就是一个对象。下面这门语言描述一张很小的表单 schema：

```
# the signup form
form signup
  text    email     required
  text    password  secret   "at least 12 characters"
  number  age       optional
```

```ts
import { defineGrammar, defineVocabulary } from '@citisen/litearea'

const FIELD_TYPES = ['text', 'number', 'bool'] as const
const OPTION_WORDS = ['required', 'optional', 'secret'] as const

const TYPES = defineVocabulary({
  id: 'field-type',
  words: FIELD_TYPES,
  scope: 'field.type',
  unknownMessage: '"{word}" is not a field type — expected {allowed}.',
  docs: {
    text: { detail: 'one line of text', body: 'The only type that can be `secret`.' },
    number: { detail: 'a number' },
    bool: { detail: 'yes or no' },
  },
})

const OPTIONS = defineVocabulary({
  id: 'option',
  words: OPTION_WORDS,
  scope: 'option',
  docs: {
    required: { detail: 'cannot be left empty' },
    optional: { detail: 'may be left empty' },
    secret: { detail: 'never shown again' },
  },
})

export const formSchema = defineGrammar({
  id: 'form-schema',
  name: 'form schema',
  // 名字里可以有连字符，所以 `email-address` 是**一个**词：补全替换整个名字，
  // 双击也会选中整个名字。
  wordChars: /[\p{L}\p{N}_-]/u,
  rules: [
    { kind: 'match', scope: 'comment', pattern: /#[^\n]*/ },
    { kind: 'match', scope: 'keyword', pattern: /form/, when: { prevNot: '\\w' } },
    {
      kind: 'match',
      scope: 'form.name',
      pattern: /[A-Za-z][\w-]*/,
      when: { after: ['keyword'] },
    },
    // 一行以字段类型开头；行首出现别的东西会被报出来，而不是安静地变成普通文本。
    { kind: 'words', words: TYPES, when: { firstOnLine: true }, unknown: {} },
    { kind: 'words', words: OPTIONS },
    { kind: 'match', scope: 'name', pattern: /[A-Za-z][\w-]*/, when: { after: ['field.type'] } },
    { kind: 'region', scope: 'note', begin: /"/, end: /"/, unclosed: { severity: 'warning' } },
    { kind: 'match', scope: 'invalid', pattern: /\S+/ },
  ],
  fallbackScope: 'text',
  compose: [
    {
      id: 'field-type',
      // 用 `firstWord` 而不是 `firstOnLine`：列表要在第一个词拼写的过程中一直有效，
      // 而不是只在整行还是空的时候有效。
      when: (context) => context.firstWord,
      range: (context) => context.word,
      items: () =>
        FIELD_TYPES.map((type) => ({
          label: type,
          append: '  ',
          kind: 'type',
          detail: TYPES.entryFor(type)?.detail,
          documentation: TYPES.entryFor(type)?.body,
        })),
    },
    {
      id: 'option',
      // 选项跟在名字后面，而名字本身可能只写了一半。
      when: (context) =>
        context.tokens.some(
          (token) =>
            token.line === context.line.number &&
            token.scope === 'name' &&
            token.to <= context.caret,
        ),
      range: (context) => context.word,
      items: () =>
        OPTION_WORDS.map((word) => ({
          label: word,
          kind: 'option',
          detail: OPTIONS.entryFor(word)?.detail,
        })),
    },
  ],
  describe: (context) => {
    const token = context.token
    if (token === undefined) return undefined
    if (token.scope === 'note') return { title: 'note', body: 'Shown under the field.' }
    const entry =
      token.scope === 'field.type' ? TYPES.entryFor(token.text) : OPTIONS.entryFor(token.text)
    return entry === undefined ? undefined : { title: token.text, body: entry.body }
  },
})
```

整个语言就是这些：八条规则、两个 vocabulary、两个补全来源和一个悬浮说明。`TYPES` 走 vocabulary，所以放错位置的词会得到一条消息，而不是安静地变成普通文本；`OPTIONS` 是不拒绝任何东西的普通规则，于是排在它下面的规则仍然有机会处理自己不认识的词。

完整参考 —— 每种规则的全部字段、优先级、诊断词汇，以及在同一门语言上补出 `analyze`、`checks`、`validate` 的端到端走查 —— 在 [docs/grammar.md](docs/grammar.md)。

## 不带任何 grammar

没有内置语言、没有可以 switch 的语言标识、没有捆绑的分词器，也没有可以导入的 grammar：`src/core/` 里没有任何代码知道字体栈是什么，包里也不发布 grammar 入口。规则由调用方提供，本文里的两个例子就是这个仓库给出的全部"写好的语言"。

这是一条刻意划下的边界，而不是遗漏。这个编辑器出自两个带真实 DSL 的插件 —— dsh-sentry 的外观文档和 dsh-font 的字体查询 —— 而这两个 grammar 现在都待在拥有它们的插件身边，作为插件交给 `createEditor`（或 `LiteAreaEditor`）的 grammar 对象。其中一个的样子值得看一眼，因为它展示了"针对真实产品写的 grammar"长什么样，也因为它清楚地说明了这段代码归谁：

```ts
// 在 dsh-font 插件里，不在 litearea 里。语言归插件所有；库只拥有读它的引擎，
// 自己一点语言都不带。
export const fontQueryGrammar = defineGrammar({
  id: 'dsh-font-query',
  // `-apple-system` 必须算作一个词，否则补全会只替换它的一半。
  wordChars: /[\p{L}\p{N}_-]/u,
  rules: [
    { kind: 'words', words: (context) => context.state.catalogue },
    { kind: 'match', scope: 'family.generic', pattern: /monospace|sans-serif|serif/ },
    { kind: 'match', scope: 'weight', pattern: /thin|light|regular|medium|bold/ },
    { kind: 'match', scope: 'separator', pattern: /,/ },
  ],
})
```

把其中任何一个 grammar 打进包里，既是扩展性陷阱，也是前后不一致：每个内联了这个库的消费者都会背上所有语言，以后再想加 JavaScript、CSS、HTML 或 Rust 的 grammar，就会让完全用不到它们的宿主包体变大。语言应该待在解析它的地方。

不过，那个插件自己的 grammar 里有两个决定仍然值得单独说明，因为它们都是拿 grammar 和被编辑的解析器对照之后发现的：

- **它刻意比宿主解析器更严格。** 插件里的 `parseStyle` 对已知选项不做取值检查：它把 `shape=bogus` 原样写进规则，之后由 `resolveLook` 悄悄换成出厂默认值，于是拼错的表现只是"图标怎么都不变"。这个 grammar 会把它报出来 —— 报成 warning 而不是 error，因为文档仍然能用，只是它说的不是它想说的。
- **它不接受 `fallback` 作为一个状态。** 插件自己的模块注释里写着 `fallback none`，但 `STYLE_STATES` 只有那四个状态，`fallback` 是内部从 `STYLE_FALLBACK_LOOK` 推导出来的，从来就没有被解析过。那句注释是过期的，把它照抄进 grammar，只会让编辑器和它服务的解析器互相矛盾。

## 自动高度

五个选项，各管一件事：

| 选项 | 默认 | 作用 |
| --- | --- | --- |
| `autoGrow` | `true` | 高度跟随内容。设为 `false` 时输入框拿到 `resize: vertical`，高度归宿主管 |
| `minRows` | `1` | 至少显示几行。它写进 textarea 原生的 `rows` 属性，所以第一帧就是对的 |
| `maxRows` | — | 超过几行开始出现滚动条 |
| `minHeight` | — | 像素高度的下限，和 `minRows` 叠加 |
| `maxHeight` | — | 像素高度的上限，和 `maxRows` 叠加 |

上面这几个选项合起来就是三条行为：

- **跟着内容长也跟着内容缩，装得下就没有滚动条。** 量到的高度没超过上限时，这个高度被写进输入框，`overflow-y` 保持 `hidden`。
- **有了上限就会出现滚动条。** 超过上限后高度固定，`overflow-y` 变成 `auto`。滚动条会压窄文本，所以量到的滚动条宽度被发布成 `--litearea-scrollbar` 并加到上色层自己的 padding 上；否则两边的换行位置会不同，每一种颜色都会从它该在的字符上滑开。下面那个「可拖高」模式下，滚动条是宿主自己造成的而不是这个选项造成的，同样会发布这个宽度。
- **下限由 `minHeight` 或 `minRows` 撑住**：取两者中较大的那个，再加上输入框的纵向 padding 和边框。上限低于下限时会被抬到下限，因为照着上限做会让盒子比宿主被告知的还小。
- **以换行结尾的文档比看上去多一行。** textarea 会把那个换行后面的空行排出来，而 `pre-wrap` 的 div 不会，所以上色层用一个行尾的 `<br>` 把这一行挣回来——是元素而不是字符，因此「上色文本精确等于输入框的值」这条依然成立。没有它，输入框能比文本多滚一行，光标就会从它底下的那个词上走开。

没挂载的输入框根本不会被量：元素还没进文档时没有布局，宽度是 0，量出来的高度会高出好几倍。`createEditor` 在挂载之后**同步**做第一次测量，原因就是为了这个；直接构造 `LiteArea` 的宿主则应该在把 `editor.element` 挂上去之后自己调一次 `refresh()`。

## 吸顶的块头

一个很长的块滚过它自己的头之后，读者就没法再叫出这个块的名字了。把块声明成 decoration，头一行就会在读者身处该块期间一直贴在框顶：

```ts
const grammar = defineGrammar({
  id: 'groups',
  rules: [{ kind: 'match', scope: 'keyword', pattern: /group/ }],
  // 每个块一个区间。嵌套关系直接从区间本身读出来。
  decorate: (text) => blocksOf(text).map((block) => ({ kind: 'block', ...block })),
})

createEditor(target, { grammar, sticky: { kinds: ['block'] } })
```

不传 `sticky` 就完全关闭。`kinds` 点名哪些 decoration 种类算块——用的就是 `decorate` 本来就返回的那些区间，所以一门语言只在**一个**地方说明什么是块；嵌套的块（类里的方法之类）会自动在父块那一行下面再堆一行，不需要额外声明。

三个决定值得知道：

- **每一行都是上色层那一行的复制**，类名一并复制，所以贴上去的表头保留它在正文里的颜色。行是从上色后的字符段重建的，而不是克隆一个 `Range`——因为整行落在同一个 span 里时它是**部分选中**的节点，克隆区间会把元素本身（连同它的颜色）丢掉。
- **这条带子不接指针事件，位置在层和输入框之间。** 输入框自己的文字是透明的，所以贴上去的表头能透过它看见，而且点在表头那一行上仍然是把光标放到那里。把带子放到输入框上面，能换来一个「点表头跳回块首」的小功能，代价是赔掉编辑器里最常见的手势。
- **块的最后一行一旦离开框顶，表头就不再贴住**，判据是那一行的下边缘——比上边缘的话会早一行取消，然后在上一块的末行还在屏幕上时就把下一块的表头闪出来。

它不移动作任何字形，所以和上色层的对齐毫无冲突。唯一的开销是测量：走一遍上色层的文本节点（按文本缓存，直到重绘才失效），加上每个块两端各一个 `Range`。

## 内联补全预览

`completion.inline` 会把当前候选行里「还没打出来的那部分」画在光标处，读者不用把视线从手上挪开，就能看着 `cir` 长成 `circle `：

```ts
createEditor(target, { grammar, completion: { inline: true } })
```

它是**预览，不是模式**。列表照常打开，方向键照常在其中移动，预览跟着当前行走，Tab 接受的还是原本该接受的东西。预览在屏幕上期间，文档、撤销历史和上色层都不会有任何变化——这正是它可以一直开着的理由。

三件它刻意不做的事：

- **它不透明。** 它站在「真实存在的字符会站的位置」，透明预览会在同一个位置用同一种字体叠上两段文字，一段看得清、一段看不清。它是一个不透明的小片，盖住它预览掉的那段文本。
- **它没有 padding 也没有边框。** 它的第一个字形必须正好在光标处，否则预览就它所生长的那个词撒了谎。
- **宁可不显示，也不显示错的。** 插入内容不以已输入内容开头的候选行（比如 `rd` 模糊匹配到 `rounded`）没有后缀可画，就不画。预览和紧随其后的那次编辑都由 `applyCompletion` 算出，所以二者不可能不一致。

它的位置取自**上色层**，而不是 mirror——这是一次修正而不是偏好：mirror 预测的是**输入框**会把光标放在哪，而输入框和上色层差了大约 1px。这个差距在「放在光标下方的浮层」里看不出来，在「必须接在上色文字后面的小片」上就一眼可见。小片同时被给了**整行的高度**（所以它盖住的是一行，而不是字体的内容盒），字形再按半个行距对齐。唯一上色层答不了的情况是「这一行什么都没画」，那时用 mirror 的预测——它报的同样是**行盒**，所以两条路径对「一行在哪」的说法是一致的。

## 打字辅助

grammar 上两个可选字段，编辑器会在读者打字时维护它们：

```ts
const grammar = defineGrammar({
  id: 'example',
  rules: […],
  pairs: [
    { open: '(', close: ')' },
    { open: '{', close: '}' },
    // 某些作用域里不该自我闭合的分隔符：典型是字符串。
    { open: '"', close: '"', notIn: ['string'] },
  ],
  comments: { line: '#' },
})

createEditor(target, { grammar, indentSize: 2 })
```

| 读者的动作 | 发生什么 |
| --- | --- |
| 输入左半边 | 成对的右半边自动补上，光标留在两者之间 |
| 选中内容后输入左半边 | 选中内容被包起来，并且仍然保持选中 |
| 输入编辑器刚插入的那个右半边 | 什么也不写，光标直接跨过去 |
| 在词前面输入左半边 | 不特殊处理——在 `value` 前打 `(` 本来就是写出 `(value` 的方式 |
| 在一对空括号之间按回车 | 变成 `{\n  \n}`，光标落在缩进后的那一行。已经用 Tab 缩进的行用 Tab 递进 |
| `Ctrl+/` / `Cmd+/` | 把选区涉及的每一行注释掉，或者把标记取回来；连按两次恢复原样 |

三点值得知道：

- **这些修改和补全一样走浏览器的编辑管线**，所以一次 Ctrl+Z 就整体撤回——自动闭合的两个字符、多行注释的每一个标记。`scripts/browser-check.mjs` 专门断言这件事，因为「写下了自己撤不回的文本」正是这个库要纠正的那个失败。
- **语言只要有行注释标记，`Ctrl+/` 就按「行」注释**，无论选区跨几行。块注释是留给「没有行注释标记」的语言的答案；两者都有的语言，块注释该是另一条命令，而不是把大家都熟悉的那条重载掉。
- **`pairs` 和 `comments` 属于 grammar，不属于选项。** 只有语言知道注释里的括号是散文、表达式里的括号是括号。`indentSize` 是偏好，所以它挂在 `createEditor` 上。

## 缩进与键位绑定

`indent.unit` 就是「一级缩进」是什么——多少空格，或者那几个字符本身。缩进命令和「在一对括号之间按回车开出的块」都用它。它挂在编辑器选项上而不是 grammar 上，因为这是口味，不是语言事实。

四个命令按一级移动文本：

| 命令 | 光标 | 选区 |
| --- | --- | --- |
| `indent` / `outdent` | 在光标处打出一级；逆缩进删掉光标周围最多一级 | 选区覆盖到的每一行移动一级 |
| `indentLines` / `outdentLines` | 光标所在那一行移动 | 同上 |

块缩进是**一次编辑**：一次 Ctrl+Z 把五行一起撤回，而且选区仍然盖着同样的行（包括刚加上的缩进），所以再按一次就是加深一级。顶格的行再逆缩进不产生改动，而**没有产生改动的命令不会吞掉这个按键**。

键位就是一张表。`DEFAULT_KEYS` 是导出的，它写明了编辑器会响应什么；宿主传的 `keys` 排在它**前面**，所以改一个键、加一个键、去掉一个键都不用把其余的重写一遍：

```ts
createEditor(target, {
  grammar,
  indent: { unit: '\t' },          // 也可以是 4，或者 '    '
  keys: [
    // VSCode 的行为。刻意不做默认：Tab 是读者离开表单的方式，库一旦把它拿走，
    // 每个输入框都会变成键盘陷阱。
    { key: 'Tab', command: 'indent' },
    { key: 'Shift+Tab', command: 'outdent' },
    { key: 'Mod+]', command: 'indentLines' },
    { key: 'Mod+[', command: 'outdentLines' },
    // 把一个默认键还给浏览器。
    { key: 'Escape', command: 'ignore' },
  ],
})
```

这张表有两点值得知道，也正是它保持很小的原因：

- **没有 `when` 表达式。** 当前不适用的绑定直接被跳过，而「适不适用」由编辑器判断、不由宿主声明：`acceptRow` 在列表开着时适用，`indent` 在关着时适用。于是一个键可以带两条绑定——`Tab` 因此在列表开着时接受、关着时可以缩进——而这一切不需要任何条件语法。
- **`ignore` 就是把键还回去的方式。** 它能匹配、它压住它下面的所有绑定、它什么也不做，于是浏览器原本的处理照常发生，就像编辑器从没见过这个键。对于一个无事可做的命令，这也是诚实的答案：顶格处逆缩进同样不消费这个按键。

`Command` 是一个**封闭集合**——编辑器本来就会做的那些动作。绑定只是给其中一个起名；它不是回调，因为宿主回调无法与编辑器自己持有的状态保持一致。

这个集合是**完整**的，把它写下来正是重点：

| 命令 | 作用 | 何时适用 |
| --- | --- | --- |
| `indent` / `outdent` | 在光标处打出一级，或让选区覆盖的每一行移动一级 | 列表关着 |
| `indentLines` / `outdentLines` | 同上，但永远按行，包括光标所在那一行 | 列表关着 |
| `toggleComment` | 加上或去掉这门语言的注释标记 | 列表关着 |
| `enterBracket` | 在一对已声明的括号之间开出缩进块 | 列表关着 |
| `openList` | 打开补全列表；已经打开时把它关掉 | 补全没被关掉 |
| `closeList` | 关掉列表 | 列表开着 |
| `acceptRow` | 接受当前行 | 列表开着 |
| `moveRowUp` / `moveRowDown` / `moveRowPageUp` / `moveRowPageDown` | 移动当前行 | 列表开着 |
| `hideTooltip` | 收起悬浮提示 | 始终 |
| `ignore` | 什么也不做，把这个键还给浏览器 | 始终 |

只有两处会读键盘而**不是**绑定，两处都是刻意的：

- **移动了光标的那个键**会关掉光标已经走出去的列表。这里不点名任何键——不是方向键，也不是 Home/End——因为键本身无关紧要：编辑器问的是「光标是不是还在列表打开时那个区间里」，所以 `Ctrl+Arrow`、按词跳转、以及宿主以后自己绑的键都覆盖到了。
- **某一行的 `commitCharacters`** 会在列表开着时拿走一次按键。它们是**行自己的数据**——由补全源声明，默认谁都没有——所以没有「和弦」可绑；要关掉这个行为，用 `completion: { commitCharacters: false }` 一次性关掉整个编辑器里的它。

## 键盘

编辑器会拦截的全部按键，以及它刻意不碰的那些：

| 按键 | 作用 |
| --- | --- |
| `ArrowDown` / `ArrowUp` | 上下移动当前行，到头就停，不环绕 |
| `PageDown` / `PageUp` | 移动八行 |
| `Enter` | 接受当前行；列表没开时，在一对已声明的括号之间开出缩进块 |
| `Tab` | 接受当前行。**不是**缩进——见上一节 |
| `Escape` | 关掉列表；列表没开时收起悬浮提示。这是**两个**命令（`closeList`、`hideTooltip`），所以任一半都可以单独改键 |
| `Ctrl+Space` / `Cmd+Space` | 打开列表；已经打开时把它关掉 |
| `Ctrl+/` / `Cmd+/` | 加上或去掉这门语言的注释标记 |
| 某一行的 `commitCharacters` | 接受当前行并把刚敲的字符写在后面，这样这个按键不会被吞掉；随后列表关闭。用 `completion: { commitCharacters: false }` 可以整体关掉这个行为 |
| `Ctrl+Z`、`Ctrl+Shift+Z`、`Ctrl+Y` | **不拦截。** 这些是浏览器自己在输入框上的撤销重做，也正是「非受控」的意义所在 |
| `Shift+Arrow`、`Home`、`End` | 不拦截。它们移动光标，随后编辑器把光标已经走出去的那个列表关掉 |

上面这张表描述的就是 `defaultKeys` 这个值本身；`keyCombo(event)` 会把一次按键写成绑定所用的拼法，这正是宿主打日志或提示快捷键时需要的。

## 主题

一个 scope 变成一个类名（`litearea-scope-value-color`），一个 decoration kind 变成一个类名（`litearea-dec-effective`），一个严重级别变成一个类名（`litearea-diag-error`）。点和其它标点会折成连字符，所以 `value.color` 直接写 `litearea-scope-value-color`，永远不需要反斜杠转义。

颜色、间距和字号来自挂在容器上的自定义属性：

| 属性 | 默认值 |
| --- | --- |
| `--litearea-font` | 一条等宽字体栈，从 `ui-monospace` 开始 |
| `--litearea-font-size` | `13px` |
| `--litearea-line-height` | `20px` |
| `--litearea-padding-block` / `--litearea-padding-inline` | `6px` / `10px` |
| `--litearea-radius` | `8px` |
| `--litearea-fg` / `--litearea-fg-dim` / `--litearea-fg-strong` | `#1f2328` / `#6b7280` / `#111827` |
| `--litearea-bg` / `--litearea-bg-raised` | `#ffffff` |
| `--litearea-border` / `--litearea-border-focus` | `#d8dbe0` / `#4d6bfe` |
| `--litearea-accent` / `--litearea-accent-soft` / `--litearea-selection` | `#4d6bfe` 以及两个带透明度的变体 |
| `--litearea-error` / `--litearea-warning` / `--litearea-info` / `--litearea-hint` | 四种严重级别的颜色 |
| `--litearea-shadow` | 浮层的阴影 |
| `--litearea-scope-*` | 出厂调色板里每个 scope 名字一个颜色，所以 grammar 自己新造的 scope 也有主题色可回退 |

深色方案由 `prefers-color-scheme` 自动应用。

```css
.myEditor .litearea {
  --litearea-font: "IBM Plex Mono", ui-monospace, monospace;
  --litearea-font-size: 12px;
  --litearea-line-height: 18px;
  --litearea-scope-comment: #8b919b;
  --litearea-scope-value-color: #0f766e;
}
```

改这些属性是安全的，因为上色层、输入框和 mirror 读的是同一组值。但只给上色层单独加一条文本属性就不安全了：上色层只允许改颜色、背景和 `text-decoration`，不能碰任何会移动字形的东西。`--litearea-scrollbar` 是编辑器写的，不要自己去设。

## 限制与诚实的说明

- **`document.execCommand` 已被废弃，而且没有替代品。** 它同时也是唯一一种在保留浏览器撤销栈的前提下修改 textarea 取值的办法。没有它的环境里，编辑靠 `setRangeText` 仍然会落地，只是历史记录拿不到 —— `canEditThroughPipeline()` 会告诉你身处哪种环境，`EditOutcome` 会告诉你某一次编辑是 `'pipeline'`、`'direct'` 还是 `'unchanged'`。
- **上色层的排版被固定成一种等宽字体，并且关掉了连字。** 连字在上色层画一个字形，而输入框画两个，于是它之后每个字符都会被画到错的位置。
- **`onChange` 只报告用户自己的编辑。** 库做的每一次写入 —— 补全，或者两种模式下的 `setValue` —— 动手前都会先被标记成自己的写入，所以调用方不会收到自己刚写进去的内容。React 的 `value` prop 也走 `setValue`，同样不会触发它。
- **`onDiagnostics` 在编辑器挂载时会先触发一次**，哪怕文档干干净净；之后只在问题列表真的变了时才触发 —— 比较的是位置、code 和 message。等待"被告知列表已清空"的宿主因此不会永远等下去。
- **在 React 绑定里，`sizing`、`completion`、`hover`、`sticky`、`indent`、`keys`、`decorations`、`injectStyles`、`styleNonce` 只在编辑器挂载时读取一次。** 之后再改这些只会重渲染外层容器。每次渲染都会重新读的只有 `grammar`、`value` 和 `readOnly`；其中只有 grammar 可以放心地每次渲染都重建（`refresh()` 会重新解析它，而不重建元素，这也是换语言时撤销历史能活下来的原因）。
- **上色层只能改颜色、背景和 text-decoration。** 任何会改变字符前进量的东西 —— 换字体、改字重、字距、字体特性 —— 都会让上色从它所属的字符上滑开，而且每个字符滑开的量都不一样。
- **每来一段新文本，`inspect` 都会完整扫一遍。** 没有增量重新词法分析，所以很大的文档每敲一个键都要付一整趟的开销。文本和分析都没变时会跳过重绘，这也是移动光标和悬浮很便宜的原因。
- **悬浮需要一个光标命中测试。** 它会问 `caretPositionFromPoint`/`caretRangeFromPoint` 指针落在哪个偏移上，`hasCaretHitTest()` 会告诉你环境里有没有。没有的话，提示就永远不会出现。
- **这不是一个完整编辑器。** 没有行号、没有搜索、没有多光标、没有括号匹配、没有折叠、没有 snippet，也没有撤销按钮 —— 浏览器的历史记录就是撤销栈，`editor.undo()` 和 `editor.redo()` 只是它上面很薄的一层，而且只能报告"这次调用是否可能"，无法报告"是否真的撤销了什么"。
- **悬浮提示和文档面板都是纯文本。** 不渲染 markdown，也不渲染 HTML：一个叫 `<b>` 的字体族就显示成 `<b>`。
- **没有 `'commit'` 这个补全触发类型。** 提交字符会接受当前行、写入那个字符并关掉列表；之后再敲什么都是普通的 `'auto'`。`CompletionTrigger` 只有 `'auto' | 'explicit'`。

## 许可证

MIT
