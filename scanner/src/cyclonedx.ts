import type {
  ComponentGroup, ConfigScope, DocComponent, HookEntry, McpServer, NpmPackage, PluginInfo,
} from "./types.ts";
import { compare } from "./util.ts";

export const SCANNER_NAME = "cronenberg-scanner";
export const SCANNER_VERSION = "0.1.0";
const ROOT_REF = "agent-environment";
const HTTP_URL = /^https?:\/\/\S+$/;

type Json = Record<string, unknown>;
interface Property {
  name: string;
  value: string;
}

// `agentbom:*` is our own namespace until the CycloneDX Agent BOM proposal (#895) lands.
function properties(entries: Record<string, string | number | boolean | undefined>): Property[] {
  return Object.entries(entries)
    .filter((e): e is [string, string | number | boolean] => e[1] !== undefined && e[1] !== "")
    .map(([key, value]) => ({ name: `agentbom:${key}`, value: String(value) }))
    .sort((a, b) => compare(a.name, b.name));
}

class Refs {
  private readonly used = new Set<string>();
  take(base: string): string {
    let ref = base;
    for (let n = 2; this.used.has(ref); n++) ref = `${base}~${n}`;
    this.used.add(ref);
    return ref;
  }
}

const refOf = (c: Json) => c["bom-ref"] as string;
const byRef = (a: Json, b: Json) => compare(refOf(a), refOf(b));

function docComponent(refs: Refs, owner: string, d: DocComponent): Json {
  const c: Json = {
    type: "data",
    "bom-ref": refs.take(`${owner}/${d.kind}/${d.name}`),
    name: d.name,
    hashes: [{ alg: "SHA-256", content: d.sha256 }],
    properties: properties({
      kind: d.kind,
      path: d.path,
      model: d.model,
      tools: d.kind === "agent" ? (d.tools ? d.tools.join(",") : "<inherits all>") : undefined,
      parseError: d.parseError,
    }),
  };
  if (d.description) c.description = d.description;
  return c;
}

function hookComponent(refs: Refs, owner: string, h: HookEntry): Json {
  return {
    type: "data",
    "bom-ref": refs.take(`${owner}/hook/${h.event}/${h.commandSha256.slice(0, 12)}`),
    name: `${h.event} ${h.matcher}`,
    hashes: [{ alg: "SHA-256", content: h.commandSha256 }],
    properties: properties({
      kind: "hook",
      event: h.event,
      matcher: h.matcher,
      type: h.type,
      interpreter: h.interpreter,
      commandLength: h.commandLength,
      source: h.source,
    }),
  };
}

function mcpProperties(s: McpServer): Property[] {
  return properties({
    kind: "mcp-server",
    transport: s.transport,
    source: s.source,
    command: s.command,
    args: s.args?.join(" "),
    pinned: s.pinned,
    envKeys: s.envKeys.join(","),
    headerKeys: s.headerKeys.join(","),
  });
}

function npmComponent(refs: Refs, owner: string, p: NpmPackage): Json {
  const c: Json = {
    type: "library",
    "bom-ref": refs.take(`${owner}/npm/${p.purl}`),
    name: p.name,
    version: p.version,
    purl: p.purl,
    properties: properties({ kind: "npm-package", dev: p.dev || undefined }),
  };
  if (p.sha512) c.hashes = [{ alg: "SHA-512", content: p.sha512 }];
  return c;
}

interface Children {
  components: Json[];
  services: Json[];
  dependsOn: string[];
}

function buildChildren(refs: Refs, owner: string, group: ComponentGroup, npm: readonly NpmPackage[]): Children {
  const components: Json[] = [...group.skills, ...group.agents, ...group.commands].map((d) =>
    docComponent(refs, owner, d),
  );
  components.push(...group.hooks.map((h) => hookComponent(refs, owner, h)));

  // stdio servers run locally (a component); http/sse servers are remote (a service).
  const services: Json[] = [];
  for (const s of group.mcpServers) {
    const ref = refs.take(`${owner}/mcp/${s.name}`);
    if (s.transport === "stdio") {
      components.push({ type: "application", "bom-ref": ref, name: s.name, properties: mcpProperties(s) });
    } else {
      const service: Json = { "bom-ref": ref, name: s.name, "x-trust-boundary": true, properties: mcpProperties(s) };
      if (s.url && HTTP_URL.test(s.url)) service.endpoints = [s.url];
      services.push(service);
    }
  }
  components.push(...npm.map((p) => npmComponent(refs, owner, p)));

  components.sort(byRef);
  services.sort(byRef);
  return { components, services, dependsOn: [...components, ...services].map(refOf).sort(compare) };
}

function counts(group: ComponentGroup): { fileCount: number; symlinkCount: number | undefined } {
  const symlinks = group.files.filter((f) => "symlink" in f).length;
  return { fileCount: group.files.length - symlinks, symlinkCount: symlinks || undefined };
}

function pluginComponent(refs: Refs, p: PluginInfo): { component: Json; children: Children } {
  const ref = refs.take(p.ref);
  const children = buildChildren(refs, ref, p, p.npm);
  const c: Json = {
    type: "application",
    "bom-ref": ref,
    name: p.name,
    properties: properties({
      kind: "plugin",
      marketplace: p.marketplace,
      scope: p.scope,
      enabled: p.enabled,
      missing: p.missing || undefined,
      outsidePluginsDir: p.outsidePluginsDir || undefined,
      gitCommitSha: p.gitCommitSha,
      installPath: p.installPath,
      nodeModulesUnlocked: p.nodeModulesUnlocked || undefined,
      errorCount: p.errors.length || undefined,
      ...counts(p),
    }),
  };
  if (p.version) c.version = p.version;
  if (p.manifest.description) c.description = p.manifest.description;
  if (p.manifest.license) c.licenses = [{ license: { name: p.manifest.license } }];
  if (p.manifest.author) c.authors = [{ name: p.manifest.author }];
  const external: Json[] = [];
  if (p.manifest.repository) external.push({ type: "vcs", url: p.manifest.repository });
  if (p.manifest.homepage) external.push({ type: "website", url: p.manifest.homepage });
  if (external.length) c.externalReferences = external;
  if (p.digest) c.hashes = [{ alg: "SHA-256", content: p.digest }];
  if (children.components.length) c.components = children.components;
  return { component: c, children };
}

function scopeComponent(refs: Refs, s: ConfigScope): { component: Json; children: Children } {
  const ref = refs.take(s.ref);
  const children = buildChildren(refs, ref, s, []);
  const c: Json = {
    type: "application",
    "bom-ref": ref,
    name: s.name,
    properties: properties({ kind: "config", location: s.location, errorCount: s.errors.length || undefined, ...counts(s) }),
  };
  if (s.digest) c.hashes = [{ alg: "SHA-256", content: s.digest }];
  if (children.components.length) c.components = children.components;
  return { component: c, children };
}

export interface BomInput {
  plugins: readonly PluginInfo[];
  scopes: readonly ConfigScope[];
  timestamp: string;
  serialNumber: string;
}

export function buildBom(input: BomInput): Json {
  const refs = new Refs();
  refs.take(ROOT_REF);
  const components: Json[] = [];
  const services: Json[] = [];
  const dependencies: Json[] = [];

  const built = [
    ...input.plugins.map((p) => pluginComponent(refs, p)),
    ...input.scopes.map((s) => scopeComponent(refs, s)),
  ];
  for (const { component, children } of built) {
    components.push(component);
    services.push(...children.services);
    if (children.dependsOn.length) dependencies.push({ ref: refOf(component), dependsOn: children.dependsOn });
  }
  components.sort(byRef);
  services.sort(byRef);
  dependencies.sort((a, b) => compare(a.ref as string, b.ref as string));
  if (components.length) dependencies.unshift({ ref: ROOT_REF, dependsOn: components.map(refOf) });

  const bom: Json = {
    bomFormat: "CycloneDX",
    specVersion: "1.7",
    serialNumber: input.serialNumber,
    version: 1,
    metadata: {
      timestamp: input.timestamp,
      tools: { components: [{ type: "application", name: SCANNER_NAME, version: SCANNER_VERSION }] },
      component: { type: "application", "bom-ref": ROOT_REF, name: ROOT_REF },
    },
    components,
    dependencies,
  };
  if (services.length) bom.services = services;
  return bom;
}
