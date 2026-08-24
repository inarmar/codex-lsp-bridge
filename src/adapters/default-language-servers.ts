import type { LanguageDescriptor } from "./language-registry.js";

/**
 * The defaults layer of Bridge Config language servers. Built-in languages are
 * ordinary descriptor records, identical in format and treatment to user-supplied
 * ones — the only place in code where concrete language names appear.
 */
export const defaultLanguageServers: Record<string, LanguageDescriptor> = {
  typescript: {
    languageId: "typescript",
    command: "typescript-language-server",
    args: ["--stdio"],
    extensions: [".ts", ".tsx", ".js", ".jsx"],
    workspaceSeedFiles: [
      "src/index.ts",
      "src/index.tsx",
      "src/main.ts",
      "src/main.tsx",
      "src/app.ts",
      "src/app.tsx",
      "src/proxy.ts",
      "src/instrumentation.ts",
      "app/page.tsx",
      "pages/index.tsx"
    ],
    installHint: "npm install -g typescript-language-server typescript",
    supportLevel: "primary"
  },
  rust: {
    languageId: "rust",
    command: "rust-analyzer",
    args: [],
    extensions: [".rs"],
    workspaceSeedFiles: ["src/main.rs", "src/lib.rs"],
    installHint: "rustup component add rust-analyzer",
    supportLevel: "experimental"
  },
  python: {
    languageId: "python",
    command: "pyright-langserver",
    args: ["--stdio"],
    extensions: [".py"],
    workspaceSeedFiles: ["main.py", "src/main.py", "app.py", "src/app.py"],
    installHint: "npm install -g pyright",
    supportLevel: "experimental"
  },
  go: {
    languageId: "go",
    command: "gopls",
    args: [],
    extensions: [".go"],
    workspaceSeedFiles: ["main.go", "cmd/main.go"],
    installHint: "go install golang.org/x/tools/gopls@latest",
    supportLevel: "experimental"
  },
  svelte: {
    languageId: "svelte",
    command: "svelteserver",
    args: ["--stdio"],
    extensions: [".svelte"],
    workspaceSeedFiles: ["src/App.svelte", "src/routes/+page.svelte"],
    installHint: "npm install -g svelte-language-server",
    supportLevel: "experimental"
  }
};
