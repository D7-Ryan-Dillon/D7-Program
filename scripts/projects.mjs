// Lists the projects saved in Supabase (code, last saved, size of the row, tiles, files in storage), or removes the ones you name.
//   node scripts/projects.mjs                 list everything
//   node scripts/projects.mjs delete a b c    delete those project codes (row, settings row and every file)
// Reads NEXT_PUBLIC_SUPABASE_URL / _PUBLISHABLE_KEY from .env.local.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
const BUCKET = "tile-assets";

/** every file under a prefix, recursively: [{path, size}] */
async function files(prefix) {
  const out = [];
  const walk = async (dir) => {
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await sb.storage.from(BUCKET).list(dir, { limit: 100, offset });
      if (error) throw error;
      if (!data.length) break;
      for (const e of data) {
        const p = dir ? `${dir}/${e.name}` : e.name;
        if (e.id === null) await walk(p);
        else out.push({ path: p, size: e.metadata?.size ?? 0 });
      }
      if (data.length < 100) break;
    }
  };
  await walk(prefix);
  return out;
}

const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;

async function list() {
  // the row's state is not downloaded (it can be huge): only the code and dates
  const { data: rows, error } = await sb.from("projects").select("code, updated_at").order("updated_at", { ascending: false }).limit(1000);
  if (error) throw error;
  const top = await sb.storage.from(BUCKET).list("", { limit: 1000 });
  if (top.error) throw top.error;
  const dirs = new Set(top.data.map((e) => e.name));
  const codes = new Set(rows.filter((r) => !r.code.endsWith("~ui")).map((r) => r.code));
  for (const d of dirs) codes.add(d);
  const byCode = new Map(rows.map((r) => [r.code, r]));
  const lines = [];
  for (const code of [...codes].sort()) {
    const fs = dirs.has(code) ? await files(code) : [];
    const tiles = new Set(fs.map((f) => f.path.split("/")[1])).size;
    const total = fs.reduce((a, f) => a + f.size, 0);
    lines.push({ code, saved: byCode.get(code)?.updated_at?.slice(0, 16).replace("T", " ") ?? "(no row)", ui: byCode.has(`${code}~ui`), tiles, files: fs.length, total });
  }
  console.log("code".padEnd(26), "last saved".padEnd(17), "tiles", "files", "storage", "settings row");
  for (const l of lines) console.log(l.code.padEnd(26), String(l.saved).padEnd(17), String(l.tiles).padStart(5), String(l.files).padStart(5), mb(l.total).padStart(8), l.ui ? "yes" : "-");
  console.log(`\n${lines.length} projects, ${mb(lines.reduce((a, l) => a + l.total, 0))} in storage`);
}

async function del(codes) {
  for (const code of codes) {
    if (code === "test1") {
      console.log("skipping test1 (protected)");
      continue;
    }
    const fs = await files(code);
    for (let i = 0; i < fs.length; i += 100) {
      const { error } = await sb.storage.from(BUCKET).remove(fs.slice(i, i + 100).map((f) => f.path));
      if (error) throw error;
    }
    // the table has no delete rule for the public key: empty the rows instead (a script with the service key, or the SQL in supabase/setup.sql, removes them fully)
    const del = await sb.from("projects").delete().in("code", [code, `${code}~ui`]).select("code");
    if (del.error) throw del.error;
    let rowNote = `${del.data.length} row(s) deleted`;
    if (!del.data.length) {
      const up = await sb.from("projects").update({ state: {} }).in("code", [code, `${code}~ui`]).select("code");
      rowNote = up.error ? `rows could not be emptied: ${up.error.message}` : `rows emptied (${up.data.length}); delete rule missing`;
    }
    console.log(`${code}: ${fs.length} files removed, ${rowNote}`);
  }
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "delete") await del(rest);
else await list();
