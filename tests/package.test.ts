import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { initialSettings, parseSettings } from "../src/config.ts";
const root = new URL("..", import.meta.url);

test("public example matches init output exactly", async () => {
  const example = JSON.parse(await readFile(new URL("examples/next-prompt.example.json", root), "utf8"));
  assert.deepEqual(parseSettings(example), initialSettings());
  assert.deepEqual(example, initialSettings());
});

test("manifest contains portable Pi package metadata and host peers only at runtime", async () => {
  const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  assert.ok(pkg.keywords.includes("pi-package"));
  assert.deepEqual(pkg.pi.extensions, ["./src/extension.ts"]);
  assert.equal(pkg.peerDependencies["@earendil-works/pi-ai"], "*");
  assert.equal(pkg.peerDependencies["@earendil-works/pi-coding-agent"], "*");
  assert.ok(!pkg.dependencies);
  for (const value of Object.values(pkg.devDependencies)) assert.ok(!String(value).startsWith("file:"));
});

test("GitHub distribution metadata and both installation guides use the public repository", async () => {
  const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  assert.deepEqual(pkg.repository, { type: "git", url: "git+https://github.com/yuxiang-gao/pi-next-prompt.git" });
  assert.equal(pkg.homepage, "https://github.com/yuxiang-gao/pi-next-prompt#readme");
  assert.equal(pkg.bugs.url, "https://github.com/yuxiang-gao/pi-next-prompt/issues");
  for (const file of ["README.md", "README.zh-CN.md"]) {
    const doc = await readFile(new URL(file, root), "utf8");
    assert.ok(doc.includes("pi install git:github.com/yuxiang-gao/pi-next-prompt"), file);
    assert.ok(doc.includes("pi remove git:github.com/yuxiang-gao/pi-next-prompt"), file);
    assert.ok(doc.includes("pi -e git:github.com/yuxiang-gao/pi-next-prompt"), file);
    assert.ok(!doc.includes("npm:<package-name>"), file);
  }
});

test("English and Chinese READMEs link to one another and the bundled title art", async () => {
  const english = await readFile(new URL("README.md", root), "utf8");
  const chinese = await readFile(new URL("README.zh-CN.md", root), "utf8");
  assert.ok(english.includes("README.zh-CN.md"));
  assert.ok(chinese.includes("README.md"));
  for (const doc of [english, chinese]) {
    assert.ok(doc.includes("assets/banner.png"));
    for (const command of ["/next-prompt init", "/next-prompt enable", "/next-prompt disable", "/next-prompt reload", "/next-prompt status"]) assert.ok(doc.includes(command));
  }
  assert.ok(english.includes("Get your first suggestion"));
  assert.ok(chinese.includes("第一条建议"));
});

test("title PNG and editable SVG are valid, bundled, and gallery-ready", async () => {
  const png = await readFile(new URL("assets/banner.png", root));
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 1600);
  assert.equal(png.readUInt32BE(20), 800);
  assert.match(await readFile(new URL("assets/banner.svg", root), "utf8"), /viewBox="0 0 1600 800"/);
  const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  assert.equal(pkg.pi.image, "assets/banner.png");
  assert.ok(pkg.files.includes("assets/"));
  assert.ok(pkg.files.includes("README.zh-CN.md"));
});

test("package bundles architecture docs and upstream MIT attribution", async () => {
  const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  for (const path of ["docs/configuration.md", "docs/debugging.md", "docs/development.md", "THIRD_PARTY_NOTICES.md"]) assert.ok(pkg.files.includes(path));
  assert.match(await readFile(new URL("THIRD_PARTY_NOTICES.md", root), "utf8"), /Copyright \(c\) 2026 Spencer Boucher/);
  for (const file of ["README.md", "README.zh-CN.md"]) assert.match(await readFile(new URL(file, root), "utf8"), /justmytwospence\/pi-next-prompt/);
});

test("publishable source, docs and lock contain no machine-specific paths or private registries", async () => {
  async function scan(dir: URL): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if ([".git", "node_modules"].includes(entry.name)) continue;
      const path = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);
      if (entry.isDirectory()) await scan(path);
      else {
        if (/\.(?:png|jpg|webp)$/iu.test(entry.name)) continue;
        const body = await readFile(path, "utf8");
        const forbidden = new RegExp(["/" + "Users/" + "[A-Za-z]", "/" + "home/" + "[A-Za-z]", "registry[.]" + "npmmirror[.]com", "file:" + "[.][.]/"].join("|"), "u");
        assert.ok(!forbidden.test(body), entry.name);
      }
    }
  }
  await scan(root);
});
