/**
 * CodeArena Local Server - v2
 * Run: node server.js
 * Listens on http://localhost:3001
 */

const http = require("http");
const { exec } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PORT = 3001;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

// Language configs - tries multiple commands for compatibility
const LANGS = {
  python: {
    ext: "py",
    // Try python3 first, fallback to python, then py (Windows)
    runners: ["python3", "python", "py"],
    buildCmd: (runner, file) => `${runner} "${file}"`,
  },
  javascript: {
    ext: "js",
    runners: ["node"],
    buildCmd: (runner, file) => `${runner} "${file}"`,
  },
  cpp: {
    ext: "cpp",
    compilers: ["g++"],
    buildCompile: (compiler, src, bin) => `${compiler} -o "${bin}" "${src}" -std=c++17`,
    buildRun: (bin) => `"${bin}"`,
  },
  c: {
    ext: "c",
    compilers: ["gcc"],
    buildCompile: (compiler, src, bin) => `${compiler} -o "${bin}" "${src}"`,
    buildRun: (bin) => `"${bin}"`,
  },
  java: {
    ext: "java",
    compilers: ["javac"],
    buildCompile: (compiler, src) => `${compiler} "${src}"`,
    buildRun: (dir, cls) => `java -cp "${dir}" ${cls}`,
    isJava: true,
  },
};

// Wrap exec in a promise
function runCmd(cmd, stdin = "", timeout = 12000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const proc = exec(cmd, { timeout, shell: true }, (err, stdout, stderr) => {
      const elapsed = Date.now() - start;
      if (err && err.killed) {
        resolve({ stdout: "", stderr: "", timedOut: true, elapsed });
      } else {
        resolve({ stdout: stdout || "", stderr: stderr || "", timedOut: false, elapsed, code: err?.code });
      }
    });
    if (stdin !== "" && proc.stdin) {
      try { proc.stdin.write(stdin); proc.stdin.end(); } catch (_) {}
    }
  });
}

// Check if a command exists on the system
function cmdExists(cmd) {
  return new Promise((resolve) => {
    const check = process.platform === "win32" ? `where ${cmd}` : `which ${cmd}`;
    exec(check, (err) => resolve(!err));
  });
}

async function findRunner(runners) {
  for (const r of runners) {
    if (await cmdExists(r)) return r;
  }
  return null;
}

async function execute(language, code, stdin) {
  const cfg = LANGS[language];
  if (!cfg) return { output: "", error: `Language "${language}" not supported.`, elapsed: 0 };

  const tmpDir = os.tmpdir();
  const id = `ca_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  // ── JAVA ──
  if (language === "java") {
    const match = code.match(/public\s+class\s+(\w+)/);
    const cls = match ? match[1] : "Main";
    const srcFile = path.join(tmpDir, `${cls}.java`);
    fs.writeFileSync(srcFile, code, "utf8");

    const compiler = await findRunner(cfg.compilers);
    if (!compiler) {
      return { output: "", error: "❌ Java (javac) not found.\nInstall JDK from: https://adoptium.net", elapsed: 0, phase: "Setup Error" };
    }

    const compileResult = await runCmd(cfg.buildCompile(compiler, srcFile), "", 20000);
    if (compileResult.stderr?.trim()) {
      cleanup([srcFile]);
      return { output: "", error: compileResult.stderr, elapsed: compileResult.elapsed, phase: "Compilation Error" };
    }

    const runResult = await runCmd(cfg.buildRun(tmpDir, cls), stdin, 10000);
    cleanup([srcFile, path.join(tmpDir, cls + ".class")]);

    if (runResult.timedOut) return { output: "", error: "⏱ Time Limit Exceeded (10s)", elapsed: runResult.elapsed, phase: "TLE" };
    return { output: runResult.stdout, error: runResult.stderr || null, elapsed: runResult.elapsed };
  }

  // ── COMPILED (C / C++) ──
  if (cfg.compilers) {
    const srcFile = path.join(tmpDir, `${id}.${cfg.ext}`);
    const binFile = path.join(tmpDir, id + (process.platform === "win32" ? ".exe" : ""));
    fs.writeFileSync(srcFile, code, "utf8");

    const compiler = await findRunner(cfg.compilers);
    if (!compiler) {
      const name = language === "cpp" ? "g++ (MinGW)" : "gcc (MinGW)";
      return { output: "", error: `❌ ${name} not found.\nInstall from: https://winlibs.com`, elapsed: 0, phase: "Setup Error" };
    }

    const compileResult = await runCmd(cfg.buildCompile(compiler, srcFile, binFile), "", 20000);
    if (compileResult.stderr?.trim()) {
      cleanup([srcFile]);
      return { output: "", error: compileResult.stderr, elapsed: compileResult.elapsed, phase: "Compilation Error" };
    }

    const runResult = await runCmd(cfg.buildRun(binFile), stdin, 10000);
    cleanup([srcFile, binFile]);

    if (runResult.timedOut) return { output: "", error: "⏱ Time Limit Exceeded (10s)", elapsed: runResult.elapsed, phase: "TLE" };
    return { output: runResult.stdout, error: runResult.stderr || null, elapsed: runResult.elapsed };
  }

  // ── INTERPRETED (Python / JS) ──
  const srcFile = path.join(tmpDir, `${id}.${cfg.ext}`);
  fs.writeFileSync(srcFile, code, "utf8");

  const runner = await findRunner(cfg.runners);
  if (!runner) {
    const msg = language === "python"
      ? `❌ Python not found.\n\nInstall from: https://www.python.org/downloads/\n\n⚠ During install CHECK: "Add Python to PATH"`
      : `❌ Node.js not found.\n\nInstall from: https://nodejs.org`;
    return { output: "", error: msg, elapsed: 0, phase: "Setup Error" };
  }

  const result = await runCmd(cfg.buildCmd(runner, srcFile), stdin, 10000);
  cleanup([srcFile]);

  if (result.timedOut) return { output: "", error: "⏱ Time Limit Exceeded (10s)", elapsed: result.elapsed, phase: "TLE" };
  return { output: result.stdout, error: result.stderr || null, elapsed: result.elapsed };
}

function cleanup(files) {
  files.forEach((f) => { try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (_) {} });
}

// ── HTTP SERVER ──
const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") { res.writeHead(204, CORS); res.end(); return; }

  if (req.method === "GET" && req.url === "/ping") {
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  if (req.method === "POST" && req.url === "/run") {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", async () => {
      try {
        const { language, code, stdin } = JSON.parse(body);
        console.log(`[${new Date().toLocaleTimeString()}] ▶ Running ${language}...`);
        const result = await execute(language, code, stdin || "");
        console.log(`   ✓ Done ${result.elapsed}ms | Error: ${!!result.error}`);
        res.writeHead(200, CORS);
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(400, CORS);
        res.end(JSON.stringify({ output: "", error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404, CORS);
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════════╗`);
  console.log(`║   CodeArena Server  →  localhost:${PORT}   ║`);
  console.log(`╚══════════════════════════════════════════╝`);
  console.log(`  Supports: Python · JS · C++ · C · Java`);
  console.log(`  Open index.html in Live Server to start\n`);
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.error(`\n❌ Port ${PORT} is already in use.`);
    console.error(`   Close other terminal running server.js and try again.\n`);
  } else {
    console.error("Server error:", e);
  }
});
