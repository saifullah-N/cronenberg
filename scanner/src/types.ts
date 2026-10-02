export interface FileRecord {
  path: string; // relative to the component root, "/"-separated
  size: number;
  sha256: string;
}

export interface SymlinkRecord {
  path: string;
  symlink: true;
}

export type TreeRecord = FileRecord | SymlinkRecord;

export type DocKind = "skill" | "agent" | "command";

export interface DocComponent {
  kind: DocKind;
  name: string;
  path: string;
  sha256: string;
  description?: string;
  model?: string;
  tools?: string[]; // undefined for agents = inherits all tools
  parseError?: string;
}

export interface HookEntry {
  source: string;
  event: string;
  matcher: string;
  type: string;
  interpreter: string;
  commandSha256: string;
  commandLength: number;
}

export interface McpServer {
  source: string;
  name: string;
  transport: string;
  command?: string;
  args?: string[]; // secret-looking values redacted
  url?: string; // scheme://host/path only; no query or credentials
  urlHost?: string;
  envKeys: string[]; // names only, never values
  headerKeys: string[];
  pinned?: boolean; // only for package runners (npx, uvx, ...)
}

export interface NpmPackage {
  name: string;
  version: string;
  purl: string;
  dev: boolean;
  sha512?: string;
}

export interface ComponentGroup {
  skills: DocComponent[];
  agents: DocComponent[];
  commands: DocComponent[];
  hooks: HookEntry[];
  mcpServers: McpServer[];
  files: TreeRecord[];
  errors: string[];
}

export interface PluginInfo extends ComponentGroup {
  ref: string;
  id: string; // name@marketplace
  name: string;
  marketplace: string;
  scope: string;
  version?: string;
  gitCommitSha?: string;
  installPath: string;
  enabled: boolean;
  missing: boolean;
  outsidePluginsDir: boolean;
  manifest: {
    description?: string;
    repository?: string;
    homepage?: string;
    license?: string;
    author?: string;
  };
  npm: NpmPackage[];
  nodeModulesUnlocked: boolean;
  digest?: string;
}

export interface ConfigScope extends ComponentGroup {
  ref: string; // "config:user" | "config:project"
  name: string;
  location: string;
  digest?: string;
}

export interface ScanSummary {
  plugins: number;
  skills: number;
  agents: number;
  commands: number;
  hooks: number;
  hooksByEvent: Record<string, number>;
  hookInterpreters: Record<string, number>;
  mcpServers: Array<{
    owner: string;
    name: string;
    transport: string;
    command?: string;
    host?: string;
    pinned?: boolean;
  }>;
  agentsWithWriteOrShellTools: number;
  agentsInheritingAllTools: number;
  npmPackages: number;
  files: number;
  symlinks: number;
  missingPlugins: string[];
  errors: string[];
}

export interface Snapshot {
  generatedAt: string;
  root: "~";
  components: Record<string, { digest?: string; files: TreeRecord[] }>;
}
