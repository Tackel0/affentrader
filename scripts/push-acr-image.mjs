import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

function requireEnv(name) {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

const REGISTRY = requireEnv("ACR_LOGIN_SERVER");
const USERNAME = requireEnv("ACR_USERNAME");
const PASSWORD = requireEnv("ACR_PASSWORD");
const CONTEXT_DIR = requireEnv("APP_CONTEXT_DIR");
const BASE_REPO = process.env.BASE_REPO ?? "base/node";
const BASE_TAG = process.env.BASE_TAG ?? "22-bookworm-slim";
const TARGET_REPO = process.env.TARGET_REPO ?? "affenterminal";
const TARGET_TAG = process.env.TARGET_TAG ?? "v1";

const tokenCache = new Map();

function parseBearerChallenge(header) {
  if (!header || !/^Bearer\s+/i.test(header)) return null;
  const params = {};
  const re = /([a-zA-Z0-9_]+)="([^"]*)"/g;
  let m;
  while ((m = re.exec(header))) params[m[1]] = m[2];
  return params;
}

async function getBearerToken(challenge) {
  const key = `${challenge.realm}|${challenge.service}|${challenge.scope ?? ""}`;
  if (tokenCache.has(key)) return tokenCache.get(key);
  const url = new URL(challenge.realm);
  if (challenge.service) url.searchParams.set("service", challenge.service);
  if (challenge.scope) url.searchParams.set("scope", challenge.scope);
  const basic = Buffer.from(`${USERNAME}:${PASSWORD}`).toString("base64");
  const res = await fetch(url, { headers: { Authorization: `Basic ${basic}` } });
  if (!res.ok) throw new Error(`ACR token exchange failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  const tok = data.access_token || data.token;
  if (!tok) throw new Error("ACR token response did not include token.");
  tokenCache.set(key, tok);
  return tok;
}

async function registryFetch(urlOrPath, init = {}) {
  const targetUrl = urlOrPath.startsWith("http") ? urlOrPath : `https://${REGISTRY}${urlOrPath}`;
  const firstHeaders = new Headers(init.headers ?? {});
  let res = await fetch(targetUrl, { ...init, headers: firstHeaders, redirect: "manual" });
  if (res.status === 401) {
    const challenge = parseBearerChallenge(res.headers.get("www-authenticate"));
    if (!challenge?.realm) throw new Error(`Registry 401 without Bearer challenge: ${res.headers.get("www-authenticate")}`);
    await res.body?.cancel();
    const token = await getBearerToken(challenge);
    const retryHeaders = new Headers(init.headers ?? {});
    retryHeaders.set("Authorization", `Bearer ${token}`);
    res = await fetch(targetUrl, { ...init, headers: retryHeaders, redirect: "manual" });
  }
  if ([301, 302, 303, 307, 308].includes(res.status)) {
    const location = res.headers.get("location");
    await res.body?.cancel();
    if (!location) throw new Error(`Registry redirect ${res.status} without Location header.`);
    const resolved = new URL(location, targetUrl).toString();
    const redirectHeaders = new Headers(init.headers ?? {});
    redirectHeaders.delete("Authorization");
    res = await fetch(resolved, { method: init.method ?? "GET", headers: redirectHeaders, redirect: "follow" });
  }
  return res;
}

function writeOctal(buf, offset, length, value) {
  const str = value.toString(8).padStart(length - 1, "0") + "\0";
  buf.write(str, offset, length, "ascii");
}

function createUstarHeader(entryPath, typeflag, size, mode, mtimeSec) {
  const buf = Buffer.alloc(512, 0);
  const nameBytes = Buffer.from(entryPath, "utf8");
  nameBytes.copy(buf, 0, 0, Math.min(nameBytes.length, 100));
  writeOctal(buf, 100, 8, mode);
  writeOctal(buf, 108, 8, 0);
  writeOctal(buf, 116, 8, 0);
  writeOctal(buf, 124, 12, size);
  writeOctal(buf, 136, 12, mtimeSec);
  buf.fill(0x20, 148, 156); // chksum placeholder spaces
  buf.write(typeflag, 156, 1, "ascii");
  buf.write("ustar\0", 257, 6, "ascii");
  buf.write("00", 263, 2, "ascii");
  buf.write("root", 265, 4, "ascii");
  buf.write("root", 297, 4, "ascii");
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += buf[i];
  const chk = sum.toString(8).padStart(6, "0") + "\0 ";
  buf.write(chk, 148, 8, "ascii");
  return buf;
}

function createPaxRecord(key, value) {
  const payload = ` ${key}=${value}\n`;
  const payloadBytes = Buffer.byteLength(payload, "utf8");
  let len = payloadBytes + 2;
  while (String(len).length + payloadBytes !== len) {
    len = String(len).length + payloadBytes;
  }
  return Buffer.from(`${len}${payload}`, "utf8");
}

async function buildAppLayerTarGz(rootDir, outFile) {
  const diffHash = crypto.createHash("sha256");
  const layerHash = crypto.createHash("sha256");
  const gzip = zlib.createGzip({ level: 6 });
  const fileOut = fs.createWriteStream(outFile);

  const gzDone = new Promise((resolve, reject) => {
    fileOut.on("finish", resolve);
    fileOut.on("error", reject);
    gzip.on("error", reject);
  });

  gzip.on("data", (chunk) => {
    layerHash.update(chunk);
    fileOut.write(chunk);
  });
  gzip.on("end", () => fileOut.end());

  async function writeTarChunk(buf) {
    diffHash.update(buf);
    if (!gzip.write(buf)) {
      await new Promise((r) => gzip.once("drain", r));
    }
  }

  const mtimeSec = Math.floor(Date.now() / 1000);
  const emitEntry = async (tarPath, typeflag, mode, fileFullPath = null) => {
    const cleanPath = tarPath.replaceAll("\\", "/");
    const pathLen = Buffer.byteLength(cleanPath, "utf8");
    if (pathLen > 99) {
      const paxData = createPaxRecord("path", cleanPath);
      const paxHeader = createUstarHeader(`PaxHeaders/${crypto.createHash("sha1").update(cleanPath).digest("hex").slice(0, 16)}`, "x", paxData.length, 0o644, mtimeSec);
      await writeTarChunk(paxHeader);
      await writeTarChunk(paxData);
      const rem = paxData.length % 512;
      if (rem !== 0) await writeTarChunk(Buffer.alloc(512 - rem, 0));
    }
    const statSize = fileFullPath ? fs.statSync(fileFullPath).size : 0;
    const headerPath = pathLen > 99 ? cleanPath.slice(-90) : cleanPath;
    await writeTarChunk(createUstarHeader(headerPath, typeflag, statSize, mode, mtimeSec));
    if (fileFullPath && statSize > 0) {
      const content = fs.readFileSync(fileFullPath);
      await writeTarChunk(content);
      const rem = content.length % 512;
      if (rem !== 0) await writeTarChunk(Buffer.alloc(512 - rem, 0));
    }
  };

  await emitEntry("app/", "5", 0o755);

  const walk = (dir, relBase) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    const out = [];
    for (const ent of entries) {
      if (ent.name === "Dockerfile") continue;
      const full = path.join(dir, ent.name);
      const rel = relBase ? `${relBase}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        out.push({ full, rel: `${rel}/`, dir: true });
        out.push(...walk(full, rel));
      } else if (ent.isFile()) {
        out.push({ full, rel, dir: false });
      }
    }
    return out;
  };

  for (const item of walk(rootDir, "")) {
    if (item.dir) {
      await emitEntry(`app/${item.rel}`, "5", 0o755);
    } else {
      const mode = item.rel.endsWith(".sh") ? 0o755 : 0o644;
      await emitEntry(`app/${item.rel}`, "0", mode, item.full);
    }
  }

  await writeTarChunk(Buffer.alloc(1024, 0));
  gzip.end();
  await gzDone;

  return {
    diffId: `sha256:${diffHash.digest("hex")}`,
    layerDigest: `sha256:${layerHash.digest("hex")}`,
    size: fs.statSync(outFile).size,
  };
}

async function uploadBlob(repo, digest, dataOrFilePath) {
  const head = await registryFetch(`/v2/${repo}/blobs/${digest}`, { method: "HEAD" });
  if (head.status === 200) {
    await head.body?.cancel();
    return;
  }
  await head.body?.cancel();

  const start = await registryFetch(`/v2/${repo}/blobs/uploads/`, { method: "POST" });
  const loc = start.headers.get("location");
  await start.body?.cancel();
  if (start.status !== 202 || !loc) throw new Error(`Blob upload start failed (${start.status}) loc=${loc}`);

  const uploadUrl = new URL(loc.startsWith("http") ? loc : `https://${REGISTRY}${loc}`);
  uploadUrl.searchParams.set("digest", digest);

  const body = typeof dataOrFilePath === "string" ? fs.readFileSync(dataOrFilePath) : dataOrFilePath;
  const put = await registryFetch(uploadUrl.toString(), {
    method: "PUT",
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(body.byteLength),
    },
    body,
  });
  if (![201, 202, 204].includes(put.status)) {
    throw new Error(`Blob PUT failed (${put.status}): ${await put.text()}`);
  }
  await put.body?.cancel();
}

async function mountOrCopyBlob(digest) {
  const head = await registryFetch(`/v2/${TARGET_REPO}/blobs/${digest}`, { method: "HEAD" });
  if (head.status === 200) {
    await head.body?.cancel();
    return;
  }
  await head.body?.cancel();

  const mountRes = await registryFetch(`/v2/${TARGET_REPO}/blobs/uploads/?mount=${encodeURIComponent(digest)}&from=${encodeURIComponent(BASE_REPO)}`, {
    method: "POST",
  });
  await mountRes.body?.cancel();
  if (mountRes.status === 201) return;

  const srcRes = await registryFetch(`/v2/${BASE_REPO}/blobs/${digest}`);
  if (!srcRes.ok) throw new Error(`Failed reading base blob ${digest}: ${srcRes.status}`);
  const buf = Buffer.from(await srcRes.arrayBuffer());
  await uploadBlob(TARGET_REPO, digest, buf);
}

async function main() {
  const indexRes = await registryFetch(`/v2/${BASE_REPO}/manifests/${BASE_TAG}`, {
    headers: {
      Accept: [
        "application/vnd.oci.image.index.v1+json",
        "application/vnd.docker.distribution.manifest.list.v2+json",
        "application/vnd.oci.image.manifest.v1+json",
        "application/vnd.docker.distribution.manifest.v2+json",
      ].join(", "),
    },
  });
  if (!indexRes.ok) throw new Error(`Fetch base index failed (${indexRes.status}): ${await indexRes.text()}`);
  let manifest = await indexRes.json();
  if (Array.isArray(manifest.manifests)) {
    const amd64 = manifest.manifests.find((m) => m.platform?.os === "linux" && m.platform?.architecture === "amd64");
    if (!amd64) throw new Error("No linux/amd64 manifest in base index.");
    const mRes = await registryFetch(`/v2/${BASE_REPO}/manifests/${amd64.digest}`, {
      headers: {
        Accept: "application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json",
      },
    });
    if (!mRes.ok) throw new Error(`Fetch amd64 manifest failed (${mRes.status}): ${await mRes.text()}`);
    manifest = await mRes.json();
  }

  console.log("Base manifest schema:", manifest.mediaType, "layers:", manifest.layers.length);

  const cfgRes = await registryFetch(`/v2/${BASE_REPO}/blobs/${manifest.config.digest}`);
  if (!cfgRes.ok) throw new Error(`Fetch base config failed (${cfgRes.status})`);
  const config = await cfgRes.json();

  for (const layer of manifest.layers) {
    await mountOrCopyBlob(layer.digest);
  }
  console.log("Base layers mounted:", manifest.layers.length);

  const tmpGz = path.join(os.tmpdir(), `affen-layer-${Date.now()}.tar.gz`);
  try {
    const layerMeta = await buildAppLayerTarGz(CONTEXT_DIR, tmpGz);
    console.log("Built app tar.gz:", layerMeta);
    await uploadBlob(TARGET_REPO, layerMeta.layerDigest, tmpGz);
    console.log("Uploaded app layer blob:", layerMeta.layerDigest);

    const oldEnv = (config.config?.Env ?? []).filter((e) => !/^(PORT|HOSTNAME|NODE_ENV)=/.test(e));
    config.config = {
      ...(config.config ?? {}),
      Env: [...oldEnv, "NODE_ENV=production", "PORT=3000", "HOSTNAME=0.0.0.0"],
      Cmd: ["node", "server.js"],
      WorkingDir: "/app",
      ExposedPorts: { ...(config.config?.ExposedPorts ?? {}), "3000/tcp": {} },
    };
    config.created = new Date().toISOString();
    config.rootfs = {
      type: "layers",
      diff_ids: [...(config.rootfs?.diff_ids ?? []), layerMeta.diffId],
    };
    if (Array.isArray(config.history)) {
      config.history.push({ created: config.created, created_by: "AffenTerminal Next.js standalone layer" });
    }

    const cfgBuf = Buffer.from(JSON.stringify(config), "utf8");
    const cfgDigest = `sha256:${crypto.createHash("sha256").update(cfgBuf).digest("hex")}`;
    await uploadBlob(TARGET_REPO, cfgDigest, cfgBuf);

    const isOci = (manifest.mediaType ?? "").includes("oci");
    const newManifest = {
      schemaVersion: 2,
      mediaType: manifest.mediaType ?? "application/vnd.docker.distribution.manifest.v2+json",
      config: {
        mediaType: manifest.config.mediaType,
        size: cfgBuf.byteLength,
        digest: cfgDigest,
      },
      layers: [
        ...manifest.layers,
        {
          mediaType: manifest.layers[0]?.mediaType ?? (isOci ? "application/vnd.oci.image.layer.v1.tar+gzip" : "application/vnd.docker.image.rootfs.diff.tar.gzip"),
          size: layerMeta.size,
          digest: layerMeta.layerDigest,
        },
      ],
    };

    const mPut = await registryFetch(`/v2/${TARGET_REPO}/manifests/${TARGET_TAG}`, {
      method: "PUT",
      headers: { "Content-Type": newManifest.mediaType },
      body: JSON.stringify(newManifest),
    });
    if (![200, 201].includes(mPut.status)) {
      throw new Error(`Manifest PUT failed (${mPut.status}): ${await mPut.text()}`);
    }
    const manifestDigest = mPut.headers.get("docker-content-digest") ?? "";
    await mPut.body?.cancel();
    console.log(`PUSHED IMAGE: ${REGISTRY}/${TARGET_REPO}:${TARGET_TAG} (${manifestDigest})`);
  } finally {
    fs.rmSync(tmpGz, { force: true });
  }
}

await main();
