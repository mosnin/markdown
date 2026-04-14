declare module "react-arborist" {
  export type NodeApi<T = any> = any;
  export type NodeRendererProps<T = any> = any;
  export const Tree: any;
}

declare module "@xyflow/react" {
  export type Node<T = any> = any;
  export type Edge<T = any> = any;
  export type NodeProps<T = any> = any;
  export const ReactFlow: any;
  export const ReactFlowProvider: any;
  export const useReactFlow: any;
  export const Background: any;
  export const Controls: any;
  export const MiniMap: any;
  export const Handle: any;
  export const Position: any;
  export const MarkerType: any;
  export const Panel: any;
  export const useNodesState: any;
  export const useEdgesState: any;
  export const addEdge: any;
}

declare module "@dagrejs/dagre" {
  const dagre: any;
  export default dagre;
}

declare module "@uiw/react-codemirror" {
  export type Extension = any;
  const CodeMirror: any;
  export default CodeMirror;
}

declare module "cmdk" {
  export const Command: any;
}

declare module "@codemirror/view" { export const EditorView: any; }
declare module "@codemirror/lang-html" { export const html: any; }
declare module "@codemirror/lang-json" { export const json: any; export const jsonParseLinter: any; }
declare module "@codemirror/lang-javascript" { export const javascript: any; export const javascriptLanguage: any; export const typescriptLanguage: any; }
declare module "@codemirror/lang-python" { export const python: any; }
declare module "@codemirror/lang-yaml" { export const yaml: any; }
declare module "@codemirror/lang-xml" { export const xml: any; }
declare module "@codemirror/lang-sql" { export const sql: any; }
declare module "@codemirror/lang-markdown" { export const markdown: any; }
declare module "@codemirror/lang-css" { export const css: any; }
declare module "@codemirror/language" { export const StreamLanguage: any; }
declare module "@codemirror/legacy-modes/mode/shell" { export const shell: any; }
declare module "@codemirror/legacy-modes/mode/toml" { export const toml: any; }
declare module "@codemirror/legacy-modes/mode/rust" { export const rust: any; }
declare module "@codemirror/legacy-modes/mode/go" { export const go: any; }
declare module "@codemirror/legacy-modes/mode/ruby" { export const ruby: any; }
declare module "@codemirror/legacy-modes/mode/swift" { export const swift: any; }
declare module "@codemirror/legacy-modes/mode/perl" { export const perl: any; }
declare module "@codemirror/legacy-modes/mode/lua" { export const lua: any; }
declare module "@codemirror/legacy-modes/mode/haskell" { export const haskell: any; }
declare module "@codemirror/legacy-modes/mode/erlang" { export const erlang: any; }
declare module "@codemirror/legacy-modes/mode/dockerfile" { export const dockerFile: any; }
declare module "@codemirror/legacy-modes/mode/r" { export const r: any; }
declare module "@codemirror/legacy-modes/mode/clike" { export const c: any; export const cpp: any; export const csharp: any; export const java: any; export const kotlin: any; export const scala: any; }
declare module "@codemirror/lint" { export const linter: any; export const lintGutter: any; }
declare module "@codemirror/autocomplete" { export const autocompletion: any; }
declare module "@codemirror/theme-one-dark" { export const oneDark: any; }
