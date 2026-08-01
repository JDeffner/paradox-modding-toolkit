-- Headless nvim parity harness for px-lsp (see README.md in this folder).
-- Run: nvim --headless --clean -l scripts/nvim-parity/harness.lua
-- Requires PX_PARITY_MOD (a CK3 mod folder with descriptor.mod). The mod is
-- COPIED to a temp dir; the original is never touched.

local function env(name)
  local v = vim.env[name]
  if v == nil or v == "" then return nil end
  return v
end

local SRC_MOD = env("PX_PARITY_MOD")
if not SRC_MOD then
  io.stderr:write("PX_PARITY_MOD is not set (path to a CK3 mod with descriptor.mod)\n")
  vim.cmd("cq")
end
-- Resolve to absolute paths: with `-l` the source arrives cwd-relative.
local HERE = vim.fn.fnamemodify(debug.getinfo(1, "S").source:sub(2), ":p:h")
local REPO = vim.fn.fnamemodify(HERE, ":h:h")
local SERVER = env("PX_PARITY_SERVER") or (REPO .. "/packages/server/dist/server.js")
local RESULTS_FILE = HERE .. "/results.json"

-- Copy the mod to a temp workspace so the broken-file and external-edit
-- checks never touch the real mod.
local MOD = vim.fn.tempname() .. "-pxparity"
do
  local ok
  if vim.fn.has("win32") == 1 then
    vim.fn.system({ "robocopy", SRC_MOD, MOD, "/E", "/XD", ".git", "/NFL", "/NDL", "/NJH", "/NJS" })
    ok = vim.v.shell_error < 8 -- robocopy: codes 0-7 are success
  else
    ok = vim.fn.system({ "cp", "-r", SRC_MOD, MOD }) ~= nil and vim.v.shell_error == 0
  end
  if not ok then
    io.stderr:write("failed to copy mod to " .. MOD .. "\n")
    vim.cmd("cq")
  end
end

local results = { steps = {}, tests = {}, status_notifications = {}, log_messages = {} }
local failures = 0
local function step(name, data)
  results.steps[#results.steps + 1] = { name = name, data = data }
  io.stdout:write("[step] " .. name .. ": " .. tostring(data) .. "\n")
end
local function record(name, ok, ms, summary)
  results.tests[name] = { ok = ok and true or false, ms = ms, summary = summary }
  if not ok then failures = failures + 1 end
  io.stdout:write(string.format("[test] %-34s %s (%dms) %s\n", name, ok and "OK" or "FAIL", ms or -1, (summary or ""):sub(1, 120)))
end

-- Filetypes + server config, exactly as packages/server/README.md says.
vim.filetype.add({
  extension = { gui = "paradox-gui" },
  pattern = {
    [".*/common/.*%.txt"] = "paradox",
    [".*/events/.*%.txt"] = "paradox",
    [".*/history/.*%.txt"] = "paradox",
    [".*/localization/.*%.yml"] = "paradox-loc",
  },
})

local settings = { locLanguage = "english", scopeInlayHints = true }
if env("PX_PARITY_GAME_PATH") then settings.gamePath = env("PX_PARITY_GAME_PATH"):gsub("\\", "/") end
if env("PX_PARITY_LOGS_PATH") then settings.logsPath = env("PX_PARITY_LOGS_PATH"):gsub("\\", "/") end

vim.lsp.config("px_lsp", {
  cmd = { "node", SERVER, "--stdio" },
  filetypes = { "paradox", "paradox-loc", "paradox-gui" },
  root_markers = { "descriptor.mod", ".git" },
  init_options = { settings = settings },
  handlers = {
    ["paradox/status"] = function(_, result)
      results.status_notifications[#results.status_notifications + 1] = result
    end,
    ["window/logMessage"] = function(_, result)
      if #results.log_messages < 60 then results.log_messages[#results.log_messages + 1] = result.message end
    end,
  },
})
vim.lsp.enable("px_lsp")

-- Helpers -------------------------------------------------------------------

local function open(file)
  vim.cmd.edit(vim.fn.fnameescape(file))
  return vim.api.nvim_get_current_buf()
end

local function wait_attach(buf, ms)
  local ok = vim.wait(ms or 30000, function()
    return #vim.lsp.get_clients({ bufnr = buf }) > 0
  end, 200)
  return ok, vim.lsp.get_clients({ bufnr = buf })[1]
end

local function req(buf, method, params, timeout)
  local t0 = vim.uv.hrtime()
  local resp = vim.lsp.buf_request_sync(buf, method, params, timeout or 60000)
  local ms = math.floor((vim.uv.hrtime() - t0) / 1e6)
  if not resp then return nil, ms, "timeout" end
  for _, r in pairs(resp) do
    if r.err then return nil, ms, vim.inspect(r.err):sub(1, 300) end
    return r.result, ms, nil
  end
  return nil, ms, "no response entry"
end

local function pos_params(buf, line, character)
  return { textDocument = { uri = vim.uri_from_bufnr(buf) }, position = { line = line, character = character } }
end

local function find_token(buf, token)
  local lines = vim.api.nvim_buf_get_lines(buf, 0, -1, false)
  for i, l in ipairs(lines) do
    local s = l:find(token, 1, true)
    if s then return i - 1, s - 1 + math.floor(#token / 2) end
  end
  return nil, nil
end

local function loc_count(result)
  if result == nil then return 0 end
  if result.uri or result.targetUri then return 1 end
  return #result
end

local function hover_text(result)
  if not (result and result.contents) then return "" end
  local c = result.contents
  if type(c) == "table" then return c.value or vim.inspect(c) end
  return tostring(c)
end

-- Discover a mod scripted effect and (ideally) a usage site ------------------

local function first_top_level_key(file)
  local f = io.open(file, "r")
  if not f then return nil end
  for line in f:lines() do
    local key = line:match("^([A-Za-z0-9_][A-Za-z0-9_.]*)%s*=%s*{")
    if key then
      f:close()
      return key
    end
  end
  f:close()
  return nil
end

local function discover()
  local fx_files = vim.fn.glob(MOD .. "/common/scripted_effects/*.txt", false, true)
  for _, file in ipairs(fx_files) do
    local name = first_top_level_key(file)
    if name then
      -- Prefer a usage site outside the declaring file.
      local candidates = {}
      vim.list_extend(candidates, vim.fn.glob(MOD .. "/events/**/*.txt", false, true))
      vim.list_extend(candidates, vim.fn.glob(MOD .. "/common/**/*.txt", false, true))
      for _, c in ipairs(candidates) do
        if c ~= file then
          local fh = io.open(c, "r")
          if fh then
            local body = fh:read("*a")
            fh:close()
            if body:find(name, 1, true) then return name, file, c end
          end
        end
      end
      return name, file, nil
    end
  end
  return nil, nil, nil
end

-- Test run ------------------------------------------------------------------

local function run()
  local effect, declFile, useFile = discover()
  step("effect", tostring(effect))
  if not effect then
    record("discovery", false, 0, "no scripted effect found in mod")
    return
  end

  local buf = open(useFile or declFile)
  step("filetype", vim.bo[buf].filetype)
  local attached = wait_attach(buf, 45000)
  step("attach", attached)
  if not attached then
    record("attach", false, 0, "LSP did not attach")
    return
  end

  -- Wait for the mod index: poll definition on the effect reference.
  local el, ec = find_token(buf, effect)
  local indexed = false
  for _ = 1, 60 do
    local result = req(buf, "textDocument/definition", pos_params(buf, el, ec), 10000)
    if loc_count(result) > 0 then
      indexed = true
      break
    end
    vim.wait(2000)
  end
  record("index_and_definition", indexed, 0, effect)

  -- Hover: content present, and CLEAN for a bare client (M9).
  local result, ms, err = req(buf, "textDocument/hover", pos_params(buf, el, ec))
  local htext = hover_text(result)
  record("hover_content", #htext > 0, ms, err or htext:sub(1, 120))
  record("hover_no_vscode_markup", not htext:find("<span", 1, true) and not htext:find("--vscode-", 1, true), 0, "")
  record("hover_no_command_links", not htext:find("command:px.", 1, true), 0, "")

  -- Completion inside the effect body.
  result, ms, err = req(buf, "textDocument/completion", pos_params(buf, el, ec))
  local items = result and (result.items or result) or {}
  record("completion", #items > 0, ms, err or ("n=" .. #items))

  -- References + rename (request only; never applied).
  result, ms, err = req(
    buf,
    "textDocument/references",
    vim.tbl_extend("force", pos_params(buf, el, ec), { context = { includeDeclaration = true } })
  )
  record("references", loc_count(result) >= 1, ms, err or ("n=" .. loc_count(result)))
  result, ms, err = req(buf, "textDocument/rename", vim.tbl_extend("force", pos_params(buf, el, ec), { newName = "px_renamed" }))
  local edits = 0
  if result and result.changes then
    for _, e in pairs(result.changes) do edits = edits + #e end
  elseif result and result.documentChanges then
    for _, dc in ipairs(result.documentChanges) do edits = edits + #(dc.edits or {}) end
  end
  record("rename_returns_edits", edits >= 1, ms, err or ("edits=" .. edits))

  -- Symbols, folding, semantic tokens, inlay hints, formatting.
  result, ms, err = req(buf, "textDocument/documentSymbol", { textDocument = { uri = vim.uri_from_bufnr(buf) } })
  record("document_symbols", result and #result > 0, ms, err or ("n=" .. #(result or {})))
  result, ms, err = req(buf, "workspace/symbol", { query = effect:sub(1, 8) })
  record("workspace_symbols", result and #result > 0, ms, err or ("n=" .. #(result or {})))
  result, ms, err = req(buf, "textDocument/foldingRange", { textDocument = { uri = vim.uri_from_bufnr(buf) } })
  record("folding", result and #result > 0, ms, err or ("n=" .. #(result or {})))
  result, ms, err = req(buf, "textDocument/semanticTokens/full", { textDocument = { uri = vim.uri_from_bufnr(buf) } })
  record("semantic_tokens", result and result.data and #result.data > 0, ms, err or "")
  local line_count = vim.api.nvim_buf_line_count(buf)
  result, ms, err = req(buf, "textDocument/inlayHint", {
    textDocument = { uri = vim.uri_from_bufnr(buf) },
    range = { start = { line = 0, character = 0 }, ["end"] = { line = line_count - 1, character = 0 } },
  })
  record("inlay_hints_answer", result ~= nil, ms, err or ("n=" .. #(result or {})))
  result, ms, err = req(buf, "textDocument/formatting", {
    textDocument = { uri = vim.uri_from_bufnr(buf) },
    options = { tabSize = 4, insertSpaces = false },
  })
  record("formatting_answers", result ~= nil, ms, err or ("edits=" .. #(result or {})))

  -- Diagnostics on a deliberately broken file.
  local brokenDir = MOD .. (vim.fn.isdirectory(MOD .. "/events") == 1 and "/events" or "/common/scripted_effects")
  local broken = brokenDir .. "/zz_px_parity_broken.txt"
  local fh = io.open(broken, "w")
  fh:write("px_parity_broken_effect = {\n\tif = {\n\t\tlimit = { always = yes }\n")
  fh:close()
  local bbuf = open(broken)
  wait_attach(bbuf, 15000)
  vim.wait(20000, function() return #vim.diagnostic.get(bbuf) > 0 end, 500)
  local diags = vim.diagnostic.get(bbuf)
  record("diagnostics_broken_file", #diags > 0, 0, diags[1] and diags[1].message:sub(1, 100) or "none")

  -- External edit pickup (M9): create a NEW file outside any buffer and wait
  -- for the definition to appear via dynamic didChangeWatchedFiles.
  local extName = "px_parity_external_effect"
  local extFile = MOD .. "/common/scripted_effects/zz_px_parity_external.txt"
  fh = io.open(extFile, "w")
  fh:write(extName .. " = {\n\tadd_gold = 1\n}\n")
  fh:close()
  local seen = vim.wait(20000, function()
    local r = req(buf, "workspace/symbol", { query = extName }, 5000)
    return r and #r > 0
  end, 1000)
  record("external_edit_pickup", seen, 0, seen and "picked up without restart" or "NOT seen after 20s")

  -- Status mirror via window/logMessage (M9).
  local has_status_log = false
  for _, m in ipairs(results.log_messages) do
    if m:find("status:", 1, true) or m:find("tokens", 1, true) then has_status_log = true end
  end
  record("logmessage_status_mirror", has_status_log, 0, "n=" .. #results.log_messages)

  -- Localization + gui, when the mod has them.
  local locFiles = vim.fn.glob(MOD .. "/localization/**/*_l_english.yml", false, true)
  if #locFiles > 0 then
    local lbuf = open(locFiles[1])
    record("loc_filetype", vim.bo[lbuf].filetype == "paradox-loc", 0, vim.bo[lbuf].filetype)
    wait_attach(lbuf, 15000)
    result, ms, err = req(lbuf, "textDocument/documentSymbol", { textDocument = { uri = vim.uri_from_bufnr(lbuf) } })
    record("loc_symbols", result and #result > 0, ms, err or ("n=" .. #(result or {})))
  end
  local guiFiles = vim.fn.glob(MOD .. "/gui/*.gui", false, true)
  if #guiFiles > 0 then
    local gbuf = open(guiFiles[1])
    record("gui_filetype", vim.bo[gbuf].filetype == "paradox-gui", 0, vim.bo[gbuf].filetype)
  end
end

local ok, run_err = pcall(run)
if not ok then
  results.harness_error = tostring(run_err)
  failures = failures + 1
  io.stdout:write("[error] " .. tostring(run_err) .. "\n")
end

local f = io.open(RESULTS_FILE, "w")
f:write(vim.fn.json_encode(results))
f:close()
pcall(vim.fn.delete, MOD, "rf")
io.stdout:write(string.format("[done] %s — results in %s\n", failures == 0 and "ALL OK" or (failures .. " FAILURES"), RESULTS_FILE))
vim.cmd(failures == 0 and "qa!" or "cq")
