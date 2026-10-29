// Muquifo.exe: liga o banco (PostgreSQL embutido) e o servidor (Node embutido),
// fica no canto do relógio do Windows e desliga tudo ao sair.
//
// Compilado pelo csc.exe que já vem no Windows (.NET Framework 4), por isso é
// C# 5: sem $"", ?. ou nameof. Gerado por scripts/empacotar.ps1.
//
// Pasta do software:
//   Muquifo.exe
//   app\api (servidor), app\web (telas)
//   runtime\node\node.exe, runtime\pgsql\bin (PostgreSQL)
//   dados\postgres (o banco), dados\config.env (senha gerada na 1ª vez)
//   logs\

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: System.Reflection.AssemblyTitle("Muquifo")]
[assembly: System.Reflection.AssemblyProduct("Muquifo")]
[assembly: System.Reflection.AssemblyDescription("Muquifo - gestão do salão")]
[assembly: System.Reflection.AssemblyVersion("0.1.0.0")]
[assembly: System.Reflection.AssemblyFileVersion("0.1.0.0")]

namespace Muquifo
{
    static class Program
    {
        public const string MutexName = "Local\\Muquifo-Servidor";
        public const string StopEventName = "Local\\Muquifo-Desligar";

        [STAThread]
        static int Main(string[] args)
        {
            if (Array.IndexOf(args, "--desligar") >= 0) return StopRunning();

            bool created;
            using (var mutex = new Mutex(true, MutexName, out created))
            {
                var minimized = Array.IndexOf(args, "--minimizado") >= 0;
                if (!created)
                {
                    // Já está ligado: só abre a tela.
                    if (!minimized) Launcher.OpenBrowser("");
                    return 0;
                }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new Launcher(minimized));
                return 0;
            }
        }

        /**
         * "Muquifo.exe --desligar": pede para a cópia ligada desligar (banco
         * fechado direito) e espera até 90 s. Usado pelo instalador antes de
         * atualizar. Código 0 = desligado (ou já estava).
         */
        static int StopRunning()
        {
            EventWaitHandle stop;
            if (!EventWaitHandle.TryOpenExisting(StopEventName, out stop)) return 0;
            using (stop) stop.Set();
            var deadline = DateTime.Now.AddSeconds(90);
            while (DateTime.Now < deadline)
            {
                Mutex running;
                if (!Mutex.TryOpenExisting(MutexName, out running)) return 0;
                running.Dispose();
                Thread.Sleep(500);
            }
            return 1;
        }
    }

    sealed class Launcher : ApplicationContext
    {
        const string AppName = "Muquifo";
        const string RunKey = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";

        static readonly string Root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
        static readonly string DataDir = Path.Combine(Root, "dados");
        static readonly string PgData = Path.Combine(DataDir, "postgres");
        static readonly string ConfigFile = Path.Combine(DataDir, "config.env");
        static readonly string BackupDir = Path.Combine(DataDir, "backups");
        const int BackupsKept = 14;
        static readonly string LogDir = Path.Combine(Root, "logs");
        static readonly string PgBin = Path.Combine(Root, "runtime\\pgsql\\bin");
        static readonly string NodeExe = Path.Combine(Root, "runtime\\node\\node.exe");
        static readonly string ApiDir = Path.Combine(Root, "app\\api");
        /** Servidor num arquivo só (scripts/bundle-api.mjs). */
        static readonly string ServerScript = Path.Combine(ApiDir, "main.mjs");
        static readonly string WebDir = Path.Combine(Root, "app\\web");

        static int appPort = 3000;

        readonly NotifyIcon tray;
        readonly ToolStripMenuItem autostartItem;
        readonly bool minimized;
        readonly object gate = new object();
        Dictionary<string, string> config;
        Process server;
        StreamWriter serverLog;
        bool stopping;
        /** Ligado e saudável: dá para fazer backup. */
        bool ready;
        /** Restaurando backup: o servidor foi parado de propósito. */
        bool restoring;
        readonly object backupGate = new object();
        System.Threading.Timer backupTimer;
        readonly List<DateTime> crashes = new List<DateTime>();
        readonly IntPtr job = Job.Create();

        public Launcher(bool minimized)
        {
            this.minimized = minimized;
            var menu = new ContextMenuStrip();
            var open = menu.Items.Add("Abrir o Muquifo", null, delegate { OpenBrowser(""); });
            open.Font = new Font(open.Font, FontStyle.Bold);
            menu.Items.Add("Celulares e tablets", null, delegate { OpenBrowser("conectar"); });
            menu.Items.Add(new ToolStripSeparator());
            autostartItem = new ToolStripMenuItem("Ligar junto com o Windows", null, delegate { ToggleAutostart(); });
            autostartItem.Checked = IsAutostart();
            menu.Items.Add(autostartItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Fazer backup agora", null, delegate { BackupNow(); });
            menu.Items.Add("Abrir a pasta de backups", null, delegate { Explore(BackupDir); });
            menu.Items.Add("Restaurar um backup...", null, delegate { AskRestore(); });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Abrir a pasta de dados", null, delegate { Explore(DataDir); });
            menu.Items.Add("Ver registros (logs)", null, delegate { Explore(LogDir); });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Desligar o Muquifo", null, delegate { AskQuit(); });

            tray = new NotifyIcon();
            tray.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            tray.Text = "Muquifo: ligando...";
            tray.ContextMenuStrip = menu;
            tray.Visible = true;
            tray.DoubleClick += delegate { OpenBrowser(""); };

            // Windows desligando: sem tempo para backup, só fecha o banco direito.
            SystemEvents.SessionEnding += delegate { Shutdown(false); };
            new Thread(StartAll) { IsBackground = true }.Start();
            new Thread(WaitStopRequest) { IsBackground = true }.Start();
        }

        /** Atende o "Muquifo.exe --desligar" (instalador/atualização). */
        void WaitStopRequest()
        {
            using (var stop = new EventWaitHandle(false, EventResetMode.AutoReset, Program.StopEventName))
            {
                stop.WaitOne();
            }
            // Antes de atualizar, guarda uma cópia: a versão nova pode mexer no banco.
            Shutdown(true);
            Invoke(delegate
            {
                tray.Visible = false;
                ExitThread();
            });
        }

        // ---------- Ligar ----------

        void StartAll()
        {
            try
            {
                Directory.CreateDirectory(DataDir);
                Directory.CreateDirectory(LogDir);
                CheckFiles();
                config = LoadConfig();
                appPort = int.Parse(config["PORT"]);

                var firstRun = !File.Exists(Path.Combine(PgData, "PG_VERSION"));
                if (firstRun)
                {
                    Balloon("Preparando o Muquifo", "Criando o banco de dados pela primeira vez. Leva menos de um minuto.", ToolTipIcon.Info);
                    InitDatabase();
                }
                StartPostgres();
                EnsureAppDatabase();

                if (IsListening(appPort))
                {
                    throw new LauncherException(
                        "A porta " + appPort + " já está em uso por outro programa.\n\n" +
                        "Feche o outro programa ou troque PORT em dados\\config.env.");
                }
                StartServer();
                WaitHealthy();
                ready = true;
                // Backup do dia: confere de hora em hora, faz se o último tiver mais de 20 h.
                backupTimer = new System.Threading.Timer(
                    delegate { AutoBackup(); }, null, TimeSpan.FromMinutes(2), TimeSpan.FromHours(1));

                SetStatus("Muquifo ligado");
                if (!minimized) OpenBrowser(firstRun ? "comecar" : "");
                if (firstRun)
                {
                    Balloon("Muquifo ligado", "Ele fica aqui no canto do relógio. Para os celulares, abra \"Celulares e tablets\" no menu.", ToolTipIcon.Info);
                }
            }
            catch (Exception e)
            {
                Fail(e);
            }
        }

        static void CheckFiles()
        {
            foreach (var f in new[] { NodeExe, Path.Combine(PgBin, "pg_ctl.exe"), ServerScript })
            {
                if (!File.Exists(f))
                {
                    throw new LauncherException("Arquivo do Muquifo faltando:\n" + f + "\n\nReinstale o Muquifo.");
                }
            }
        }

        static Dictionary<string, string> LoadConfig()
        {
            var values = new Dictionary<string, string>();
            if (File.Exists(ConfigFile))
            {
                foreach (var raw in File.ReadAllLines(ConfigFile))
                {
                    var line = raw.Trim();
                    if (line.Length == 0 || line.StartsWith("#")) continue;
                    var eq = line.IndexOf('=');
                    if (eq > 0) values[line.Substring(0, eq).Trim()] = line.Substring(eq + 1).Trim();
                }
            }
            var changed = false;
            changed |= Default(values, "DB_PASSWORD", RandomSecret());
            changed |= Default(values, "DB_PORT", "5544");
            changed |= Default(values, "PORT", "3000");
            changed |= Default(values, "BACKUP_EXTRA_DIR", "");
            if (changed)
            {
                var sb = new StringBuilder();
                sb.AppendLine("# Configuração do Muquifo. A senha do banco foi gerada na instalação:");
                sb.AppendLine("# guarde este arquivo junto com a pasta postgres (backup).");
                sb.AppendLine("# BACKUP_EXTRA_DIR: pasta extra para uma cópia de cada backup (pendrive,");
                sb.AppendLine("# OneDrive, Google Drive...). Ex.: BACKUP_EXTRA_DIR=E:\\Backups Muquifo");
                foreach (var kv in values) sb.AppendLine(kv.Key + "=" + kv.Value);
                File.WriteAllText(ConfigFile, sb.ToString());
            }
            return values;
        }

        static bool Default(Dictionary<string, string> values, string key, string value)
        {
            if (values.ContainsKey(key)) return false;
            values[key] = value;
            return true;
        }

        static string RandomSecret()
        {
            var bytes = new byte[18];
            using (var rng = new RNGCryptoServiceProvider()) rng.GetBytes(bytes);
            // Só letras e números: entra na URL do banco sem escapar.
            return Convert.ToBase64String(bytes).Replace('+', 'a').Replace('/', 'b').Replace('=', 'c');
        }

        void InitDatabase()
        {
            // Sobra de uma tentativa que falhou no meio: recomeça do zero.
            if (Directory.Exists(PgData) && Directory.GetFileSystemEntries(PgData).Length > 0
                && !File.Exists(Path.Combine(PgData, "PG_VERSION")))
            {
                Directory.Delete(PgData, true);
            }
            var pwfile = Path.Combine(DataDir, "pw.tmp");
            File.WriteAllText(pwfile, config["DB_PASSWORD"]);
            try
            {
                Run(Path.Combine(PgBin, "initdb.exe"),
                    "-D " + Quote(PgData) + " -U muquifo --pwfile=" + Quote(pwfile) +
                    " -A scram-sha-256 -E UTF8 --locale-provider=icu --icu-locale=pt-BR --locale=C",
                    "initdb", 180);
            }
            finally
            {
                File.Delete(pwfile);
            }
            // Só esta máquina conversa com o banco; os celulares falam com o servidor.
            File.AppendAllText(Path.Combine(PgData, "postgresql.conf"),
                "\n# Muquifo\nlisten_addresses = '127.0.0.1'\nport = " + config["DB_PORT"] +
                "\nmax_connections = 40\nlc_messages = 'C'\n");
        }

        void StartPostgres()
        {
            var ctl = Path.Combine(PgBin, "pg_ctl.exe");
            if (Run(ctl, "status -D " + Quote(PgData), null, 30, false) == 0) return;
            // Sem capturar a saída: o postgres herdaria o "cano" e ele nunca fecharia.
            // O que importa já vai para logs\banco.log (-l).
            Run(ctl, "start -w -t 90 -D " + Quote(PgData) + " -l " + Quote(Path.Combine(LogDir, "banco.log")),
                "pg_ctl start", 120, true, false);
        }

        /** Cria a base "muquifo" se faltar (inclusive se a 1ª vez parou no meio). */
        void EnsureAppDatabase()
        {
            var output = new StringBuilder();
            var code = Run(Path.Combine(PgBin, "createdb.exe"),
                "-h 127.0.0.1 -p " + config["DB_PORT"] + " -U muquifo -E UTF8 muquifo",
                "createdb", 60, false, true, output);
            if (code != 0 && output.ToString().IndexOf("already exists", StringComparison.OrdinalIgnoreCase) < 0)
            {
                throw new LauncherException("Não foi possível criar o banco de dados.\n\n" + Trim(output.ToString(), 600));
            }
        }

        void StartServer()
        {
            lock (gate)
            {
                if (stopping) return;
                var psi = new ProcessStartInfo(NodeExe, Quote(ServerScript));
                psi.WorkingDirectory = ApiDir;
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.RedirectStandardOutput = true;
                psi.RedirectStandardError = true;
                psi.StandardOutputEncoding = Encoding.UTF8;
                psi.StandardErrorEncoding = Encoding.UTF8;
                psi.EnvironmentVariables["NODE_ENV"] = "production";
                psi.EnvironmentVariables["DATABASE_URL"] =
                    "postgres://muquifo:" + config["DB_PASSWORD"] + "@127.0.0.1:" + config["DB_PORT"] + "/muquifo";
                psi.EnvironmentVariables["HOST"] = "0.0.0.0";
                psi.EnvironmentVariables["PORT"] = config["PORT"];
                psi.EnvironmentVariables["CORS_ORIGINS"] = "*";
                psi.EnvironmentVariables["API_DOCS"] = "false";
                psi.EnvironmentVariables["MIGRATE_ON_START"] = "true";
                psi.EnvironmentVariables["MIGRATIONS_DIR"] = Path.Combine(ApiDir, "drizzle");
                psi.EnvironmentVariables["WEB_DIR"] = WebDir;
                psi.EnvironmentVariables["NO_COLOR"] = "1";

                if (serverLog == null)
                {
                    serverLog = new StreamWriter(
                        new FileStream(Path.Combine(LogDir, "servidor.log"), FileMode.Append, FileAccess.Write, FileShare.ReadWrite),
                        new UTF8Encoding(false));
                    serverLog.AutoFlush = true;
                }
                serverLog.WriteLine("==== " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " ligando o servidor ====");

                var p = new Process();
                p.StartInfo = psi;
                p.EnableRaisingEvents = true;
                p.OutputDataReceived += delegate (object s, DataReceivedEventArgs e) { Log(e.Data); };
                p.ErrorDataReceived += delegate (object s, DataReceivedEventArgs e) { Log(e.Data); };
                p.Exited += delegate { OnServerExit(p); };
                p.Start();
                // Se o Muquifo.exe for encerrado à força, o Windows encerra o servidor junto.
                Job.Assign(job, p);
                p.BeginOutputReadLine();
                p.BeginErrorReadLine();
                server = p;
            }
        }

        void Log(string line)
        {
            if (line == null) return;
            lock (gate)
            {
                if (serverLog != null) serverLog.WriteLine(line);
            }
        }

        /** Caiu sozinho: religa, mas desiste se cair 5 vezes em 5 minutos. */
        void OnServerExit(Process p)
        {
            lock (gate)
            {
                if (stopping || restoring || p != server) return;
                crashes.Add(DateTime.Now);
                crashes.RemoveAll(delegate (DateTime t) { return (DateTime.Now - t).TotalMinutes > 5; });
            }
            if (crashes.Count >= 5)
            {
                SetStatus("Muquifo parado (erro)");
                Balloon("O Muquifo parou", "O servidor caiu várias vezes. Veja logs\\servidor.log ou chame o suporte.", ToolTipIcon.Error);
                return;
            }
            SetStatus("Muquifo: religando...");
            Thread.Sleep(3000);
            try
            {
                StartServer();
                WaitHealthy();
                SetStatus("Muquifo ligado");
            }
            catch (Exception e)
            {
                Fail(e);
            }
        }

        static void WaitHealthy()
        {
            var deadline = DateTime.Now.AddSeconds(90);
            while (DateTime.Now < deadline)
            {
                try
                {
                    var req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + appPort + "/api/v1/health");
                    req.Timeout = 2000;
                    using (var res = (HttpWebResponse)req.GetResponse())
                    {
                        if (res.StatusCode == HttpStatusCode.OK) return;
                    }
                }
                catch (WebException)
                {
                }
                Thread.Sleep(700);
            }
            throw new LauncherException("O servidor não respondeu a tempo. Veja logs\\servidor.log.");
        }

        static bool IsListening(int port)
        {
            try
            {
                using (var client = new System.Net.Sockets.TcpClient())
                {
                    var r = client.BeginConnect("127.0.0.1", port, null, null);
                    return r.AsyncWaitHandle.WaitOne(500) && client.Connected;
                }
            }
            catch
            {
                return false;
            }
        }

        // ---------- Desligar ----------

        void AskQuit()
        {
            var answer = MessageBox.Show(
                "Desligar o Muquifo?\n\nOs celulares e o cardápio do QR code param de funcionar até ligar de novo.",
                AppName, MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2);
            if (answer != DialogResult.Yes) return;
            SetStatus("Muquifo: desligando...");
            Shutdown(true);
            tray.Visible = false;
            ExitThread();
        }

        /** Desliga servidor e banco; `backup`: antes, guarda uma cópia se a última tiver mais de 10 min. */
        void Shutdown(bool backup)
        {
            lock (gate)
            {
                if (stopping) return;
                stopping = true;
            }
            if (backupTimer != null) backupTimer.Dispose();
            if (backup && ready && DateTime.Now - LastBackup() > TimeSpan.FromMinutes(10))
            {
                try
                {
                    Backup("ao desligar");
                }
                catch (Exception e)
                {
                    LogLine("Backup ao desligar falhou: " + e.Message);
                }
            }
            try
            {
                if (server != null && !server.HasExited)
                {
                    server.Kill();
                    server.WaitForExit(5000);
                }
            }
            catch
            {
            }
            try
            {
                if (File.Exists(Path.Combine(PgData, "PG_VERSION")))
                {
                    Run(Path.Combine(PgBin, "pg_ctl.exe"), "stop -m fast -w -t 30 -D " + Quote(PgData), null, 40, false);
                }
            }
            catch
            {
            }
            lock (gate)
            {
                if (serverLog != null) serverLog.Dispose();
                serverLog = null;
            }
        }

        // ---------- Backup ----------

        /**
         * Cópia completa do banco (pg_dump) em dados\backups, mais uma cópia na
         * pasta extra (pendrive/nuvem) se configurada. Guarda as 14 últimas.
         */
        string Backup(string reason)
        {
            lock (backupGate)
            {
                Directory.CreateDirectory(BackupDir);
                var target = Path.Combine(BackupDir, "muquifo-" + DateTime.Now.ToString("yyyy-MM-dd_HHmmss") + ".backup");
                var partial = target + ".parcial";
                var output = new StringBuilder();
                var code = Run(Path.Combine(PgBin, "pg_dump.exe"),
                    "-h 127.0.0.1 -p " + config["DB_PORT"] + " -U muquifo -Fc -f " + Quote(partial) + " muquifo",
                    "backup", 600, false, true, output);
                if (code != 0)
                {
                    if (File.Exists(partial)) File.Delete(partial);
                    throw new LauncherException("O backup falhou.\n\n" + Trim(output.ToString(), 400));
                }
                File.Move(partial, target);
                Prune(BackupDir);
                LogLine("Backup (" + reason + "): " + Path.GetFileName(target));

                string extra;
                if (config.TryGetValue("BACKUP_EXTRA_DIR", out extra) && extra.Length > 0)
                {
                    try
                    {
                        Directory.CreateDirectory(extra);
                        File.Copy(target, Path.Combine(extra, Path.GetFileName(target)), true);
                        Prune(extra);
                    }
                    catch (Exception e)
                    {
                        // Pendrive fora, nuvem desligada: o backup local continua valendo.
                        LogLine("Cópia extra do backup falhou (" + extra + "): " + e.Message);
                    }
                }
                return target;
            }
        }

        static void Prune(string dir)
        {
            var files = Directory.GetFiles(dir, "muquifo-*.backup");
            Array.Sort(files, StringComparer.Ordinal);
            for (var i = 0; i < files.Length - BackupsKept; i++)
            {
                try { File.Delete(files[i]); } catch { }
            }
        }

        static DateTime LastBackup()
        {
            if (!Directory.Exists(BackupDir)) return DateTime.MinValue;
            var last = DateTime.MinValue;
            foreach (var f in Directory.GetFiles(BackupDir, "muquifo-*.backup"))
            {
                var t = File.GetLastWriteTime(f);
                if (t > last) last = t;
            }
            return last;
        }

        void AutoBackup()
        {
            if (stopping || restoring || !ready) return;
            if (DateTime.Now - LastBackup() < TimeSpan.FromHours(20)) return;
            try
            {
                Backup("automático");
            }
            catch (Exception e)
            {
                LogLine("Backup automático falhou: " + e.Message);
                Balloon("Backup não foi feito", "O Muquifo tenta de novo em uma hora. Detalhes em logs\\muquifo.log.", ToolTipIcon.Warning);
            }
        }

        void BackupNow()
        {
            if (!ready)
            {
                MessageBox.Show("Espere o Muquifo terminar de ligar.", AppName);
                return;
            }
            new Thread(delegate ()
            {
                try
                {
                    var file = Backup("manual");
                    Balloon("Backup feito", Path.GetFileName(file) + " em dados\\backups.", ToolTipIcon.Info);
                }
                catch (Exception e)
                {
                    Balloon("Backup não foi feito", e.Message, ToolTipIcon.Error);
                }
            }) { IsBackground = true }.Start();
        }

        /** Volta o banco para um backup. Antes, guarda uma cópia de agora. */
        void AskRestore()
        {
            if (!ready)
            {
                MessageBox.Show("Espere o Muquifo terminar de ligar.", AppName);
                return;
            }
            string file;
            using (var dialog = new OpenFileDialog())
            {
                dialog.Title = "Escolha o backup para restaurar";
                dialog.Filter = "Backup do Muquifo (*.backup)|*.backup";
                dialog.InitialDirectory = Directory.Exists(BackupDir) ? BackupDir : DataDir;
                if (dialog.ShowDialog() != DialogResult.OK) return;
                file = dialog.FileName;
            }
            var when = File.GetLastWriteTime(file).ToString("dd/MM/yyyy 'às' HH:mm");
            var answer = MessageBox.Show(
                "Restaurar o backup de " + when + "?\n\n" +
                "Tudo o que foi lançado depois dele (comandas, pagamentos, caixa, cardápio) será perdido.\n" +
                "Antes, o Muquifo guarda uma cópia de agora, por segurança.\n\n" +
                "O sistema e os celulares ficam fora do ar por alguns segundos.",
                AppName, MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2);
            if (answer != DialogResult.Yes) return;
            new Thread(delegate () { Restore(file); }) { IsBackground = true }.Start();
        }

        void Restore(string file)
        {
            SetStatus("Muquifo: restaurando backup...");
            try
            {
                Backup("antes de restaurar");
                lock (gate) restoring = true;
                if (server != null && !server.HasExited)
                {
                    server.Kill();
                    server.WaitForExit(10000);
                }
                var output = new StringBuilder();
                var code = Run(Path.Combine(PgBin, "pg_restore.exe"),
                    "-h 127.0.0.1 -p " + config["DB_PORT"] + " -U muquifo -d muquifo --clean --if-exists --no-owner --single-transaction " +
                    Quote(file), "restaurar", 900, false, true, output);
                lock (gate) restoring = false;
                StartServer();
                WaitHealthy();
                SetStatus("Muquifo ligado");
                if (code != 0)
                {
                    LogLine("Restauração falhou: " + output);
                    Balloon("Backup não restaurado", "Nada foi alterado. Detalhes em logs\\muquifo.log.", ToolTipIcon.Error);
                }
                else
                {
                    Balloon("Backup restaurado", "O Muquifo voltou para " + Path.GetFileName(file) + ".", ToolTipIcon.Info);
                }
            }
            catch (Exception e)
            {
                lock (gate) restoring = false;
                Fail(e);
            }
        }

        static void LogLine(string text)
        {
            try
            {
                File.AppendAllText(Path.Combine(LogDir, "muquifo.log"),
                    DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + text + "\n");
            }
            catch
            {
            }
        }

        // ---------- Utilidades ----------

        /** Roda um programa do PostgreSQL esperando terminar; falha com o que ele disse. */
        int Run(string exe, string arguments, string step, int timeoutSeconds, bool throwOnError = true, bool capture = true,
            StringBuilder output = null)
        {
            if (output == null) output = new StringBuilder();
            var psi = new ProcessStartInfo(exe, arguments);
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = capture;
            psi.RedirectStandardError = capture;
            psi.EnvironmentVariables["PGPASSWORD"] = config != null ? config["DB_PASSWORD"] : "";
            using (var p = Process.Start(psi))
            {
                if (capture)
                {
                    p.OutputDataReceived += delegate (object s, DataReceivedEventArgs e) { if (e.Data != null) output.AppendLine(e.Data); };
                    p.ErrorDataReceived += delegate (object s, DataReceivedEventArgs e) { if (e.Data != null) output.AppendLine(e.Data); };
                    p.BeginOutputReadLine();
                    p.BeginErrorReadLine();
                }
                if (!p.WaitForExit(timeoutSeconds * 1000))
                {
                    try { p.Kill(); } catch { }
                    if (throwOnError) throw new LauncherException("O banco de dados demorou demais (" + step + ").");
                    return -1;
                }
                // Termina de ler a saída capturada (só quando há captura: sem ela não há o que esperar).
                if (capture) p.WaitForExit();
                if (p.ExitCode != 0 && throwOnError)
                {
                    File.AppendAllText(Path.Combine(LogDir, "banco.log"), "[" + step + "]\n" + output + "\n");
                    throw new LauncherException("Não foi possível ligar o banco de dados (" + step + ").\n\n" +
                        Trim(output.ToString(), 600) + "\n\nDetalhes em logs\\banco.log.");
                }
                return p.ExitCode;
            }
        }

        static string Trim(string s, int max)
        {
            s = s.Trim();
            return s.Length <= max ? s : s.Substring(s.Length - max);
        }

        static string Quote(string s)
        {
            return "\"" + s + "\"";
        }

        public static void OpenBrowser(string path)
        {
            try
            {
                Process.Start("http://localhost:" + appPort + "/" + path);
            }
            catch
            {
            }
        }

        static void Explore(string dir)
        {
            Directory.CreateDirectory(dir);
            Process.Start("explorer.exe", Quote(dir));
        }

        static bool IsAutostart()
        {
            using (var key = Registry.CurrentUser.OpenSubKey(RunKey))
            {
                return key != null && key.GetValue(AppName) != null;
            }
        }

        void ToggleAutostart()
        {
            using (var key = Registry.CurrentUser.CreateSubKey(RunKey))
            {
                if (IsAutostart()) key.DeleteValue(AppName, false);
                else key.SetValue(AppName, Quote(Application.ExecutablePath) + " --minimizado");
            }
            autostartItem.Checked = IsAutostart();
        }

        void SetStatus(string text)
        {
            Invoke(delegate { tray.Text = text; });
        }

        void Balloon(string title, string text, ToolTipIcon icon)
        {
            Invoke(delegate { tray.ShowBalloonTip(8000, title, text, icon); });
        }

        void Fail(Exception e)
        {
            var message = e is LauncherException ? e.Message : e.ToString();
            try
            {
                File.AppendAllText(Path.Combine(LogDir, "muquifo.log"),
                    DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + e + "\n");
            }
            catch
            {
            }
            SetStatus("Muquifo parado (erro)");
            Invoke(delegate
            {
                MessageBox.Show(message, AppName + ": não foi possível ligar", MessageBoxButtons.OK, MessageBoxIcon.Error);
                Shutdown(false);
                tray.Visible = false;
                ExitThread();
            });
        }

        /** Executa na thread da interface (a da bandeja), vindo de qualquer thread. */
        void Invoke(MethodInvoker action)
        {
            context.Send(delegate { action(); }, null);
        }

        // Inicializado antes do construtor, ainda na thread da interface.
        readonly SynchronizationContext context = CaptureContext();

        static SynchronizationContext CaptureContext()
        {
            if (SynchronizationContext.Current == null)
            {
                SynchronizationContext.SetSynchronizationContext(new WindowsFormsSynchronizationContext());
            }
            return SynchronizationContext.Current;
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) tray.Dispose();
            base.Dispose(disposing);
        }
    }

    sealed class LauncherException : Exception
    {
        public LauncherException(string message) : base(message) { }
    }

    /** Job do Windows: processos do grupo morrem junto com o Muquifo.exe. */
    static class Job
    {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
        static extern IntPtr CreateJobObject(IntPtr attributes, string name);

        [DllImport("kernel32.dll")]
        static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref ExtendedLimits info, int length);

        [DllImport("kernel32.dll")]
        static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

        [StructLayout(LayoutKind.Sequential)]
        struct BasicLimits
        {
            public long PerProcessUserTimeLimit;
            public long PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize;
            public UIntPtr MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass;
            public uint SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct IoCounters
        {
            public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
            public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct ExtendedLimits
        {
            public BasicLimits Basic;
            public IoCounters Io;
            public UIntPtr ProcessMemoryLimit;
            public UIntPtr JobMemoryLimit;
            public UIntPtr PeakProcessMemoryUsed;
            public UIntPtr PeakJobMemoryUsed;
        }

        const int ExtendedLimitInformation = 9;
        const uint KillOnJobClose = 0x2000;

        public static IntPtr Create()
        {
            var job = CreateJobObject(IntPtr.Zero, null);
            var info = new ExtendedLimits();
            info.Basic.LimitFlags = KillOnJobClose;
            SetInformationJobObject(job, ExtendedLimitInformation, ref info, Marshal.SizeOf(typeof(ExtendedLimits)));
            return job;
        }

        public static void Assign(IntPtr job, Process p)
        {
            AssignProcessToJobObject(job, p.Handle);
        }
    }
}
