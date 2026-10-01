#define _GNU_SOURCE
#include <webkit2/webkit2.h>
#include <dlfcn.h>
#include <signal.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <unistd.h>

static gboolean descendant(long pid) {
  for (int depth = 0; pid > 1 && depth < 64; depth++) {
    if (pid == getpid()) return TRUE;
    gchar *path = g_strdup_printf("/proc/%ld/stat", pid);
    gchar *stat = NULL;
    gboolean read = g_file_get_contents(path, &stat, NULL, NULL);
    g_free(path);
    gchar *end = read ? strrchr(stat, ')') : NULL;
    long parent = 0;
    gboolean found = end && sscanf(end + 2, "%*c %ld", &parent) == 1;
    g_free(stat);
    if (!found || parent == pid) return FALSE;
    pid = parent;
  }
  return FALSE;
}

static gboolean bundled_helpers(void) {
  const char *appdir = getenv("APPDIR");
  gboolean network = FALSE, renderer = FALSE;
  GDir *processes = g_dir_open("/proc", 0, NULL);
  const gchar *entry;
  if (!appdir || !processes) return FALSE;
  while ((entry = g_dir_read_name(processes))) {
    if (!g_ascii_isdigit(entry[0])) continue;
    if (!descendant(strtol(entry, NULL, 10))) continue;
    gchar *link = g_strdup_printf("/proc/%s/exe", entry);
    gchar *executable = g_file_read_link(link, NULL);
    g_free(link);
    if (executable && g_str_has_prefix(executable, appdir)) {
      printf("bundled descendant=%s\n", executable);
      if (g_str_has_suffix(executable, "/WebKitNetworkProcess")) {
        network = TRUE;
        gchar *maps_path = g_strdup_printf("/proc/%s/maps", entry);
        gchar *maps = NULL;
        if (g_file_get_contents(maps_path, &maps, NULL, NULL)) {
          gchar **lines = g_strsplit(maps, "\n", -1);
          for (int i = 0; lines[i]; i++) {
            if (strstr(lines[i], "/libsoup-3.0.so.")) {
              printf("network-libsoup-library=%s\n", strchr(lines[i], '/'));
              break;
            }
          }
          g_strfreev(lines);
        }
        g_free(maps);
        g_free(maps_path);
      }
      if (g_str_has_suffix(executable, "/WebKitWebProcess")) renderer = TRUE;
    }
    g_free(executable);
  }
  g_dir_close(processes);
  if (network && renderer) puts("bundled WebKit network and renderer helpers confirmed");
  return network && renderer;
}

static gboolean reject;
static gboolean tls_failed;
static gboolean finished;
static int outcome = 1;

static void finish(int status) {
  if (finished) return;
  finished = TRUE;
  outcome = status;
  gtk_main_quit();
}

static gboolean deadline(gpointer unused) {
  (void)unused;
  fprintf(stderr, "WebKit fixture timed out\n");
  finish(1);
  return G_SOURCE_REMOVE;
}

static gboolean tls_error(WebKitWebView *view, gchar *uri, GTlsCertificate *certificate,
                          GTlsCertificateFlags flags, gpointer unused) {
  (void)view; (void)uri; (void)certificate; (void)unused;
  tls_failed = flags != 0;
  return FALSE; /* Keep normal TLS rejection; never allow a certificate exception. */
}

static gboolean load_failed(WebKitWebView *view, WebKitLoadEvent event, gchar *uri,
                            GError *error, gpointer unused) {
  (void)view; (void)event; (void)uri; (void)unused;
  if (reject && tls_failed) {
    puts("WebKit untrusted TLS certificate rejected");
    finish(bundled_helpers() ? 0 : 1);
  } else {
    bundled_helpers();
    fprintf(stderr, "WebKit load failed: %s\n", error->message);
    finish(1);
  }
  return FALSE;
}

static void evaluated(GObject *view, GAsyncResult *result, gpointer unused) {
  (void)unused;
  GError *error = NULL;
  JSCValue *value = webkit_web_view_evaluate_javascript_finish(WEBKIT_WEB_VIEW(view), result, &error);
  if (error || !value || !jsc_value_to_boolean(value)) {
    fprintf(stderr, "WebKit renderer did not read fixture body\n");
    finish(1);
  } else {
    puts("WebKit rendered proxied HTTPS status=200");
    finish(bundled_helpers() ? 0 : 1);
  }
  g_clear_error(&error);
  if (value) g_object_unref(value);
}

static void loaded(WebKitWebView *view, WebKitLoadEvent event, gpointer unused) {
  (void)unused;
  if (event != WEBKIT_LOAD_FINISHED) return;
  if (reject) { finish(tls_failed && bundled_helpers() ? 0 : 1); return; }
  WebKitWebResource *resource = webkit_web_view_get_main_resource(view);
  WebKitURIResponse *response = resource ? webkit_web_resource_get_response(resource) : NULL;
  if (!response || webkit_uri_response_get_status_code(response) != 200) { finish(1); return; }
  webkit_web_view_evaluate_javascript(view, "document.body.innerText.includes('fixture healthy')",
                                      -1, NULL, NULL, NULL, evaluated, NULL);
}

int main(int argc, char **argv) {
  if (argc != 5) return 2;
  signal(SIGPIPE, SIG_IGN);
  setvbuf(stdout, NULL, _IONBF, 0);
  reject = strcmp(argv[4], "reject") == 0;
  /* The CA argument is intentionally unused: this probe exercises host trust. */
  if (!gtk_init_check(NULL, NULL)) return 1;
  Dl_info library;
  void *soup_version = dlsym(RTLD_DEFAULT, "soup_get_major_version");
  if (soup_version && dladdr(soup_version, &library))
    printf("libsoup-library=%s\n", library.dli_fname);
  printf("resolver=%s\n", G_OBJECT_TYPE_NAME(g_proxy_resolver_get_default()));
  GError *error = NULL;
  gchar **routes = g_proxy_resolver_lookup(g_proxy_resolver_get_default(), argv[1], NULL, &error);
  if (error || !routes || g_strcmp0(routes[0], argv[3]) != 0) {
    fprintf(stderr, "WebKit host resolver did not select the expected route\n");
    return 1;
  }
  g_strfreev(routes);
  WebKitWebContext *context = webkit_web_context_new_ephemeral();
  WebKitWebView *view = WEBKIT_WEB_VIEW(webkit_web_view_new_with_context(context));
  GtkWidget *window = gtk_window_new(GTK_WINDOW_TOPLEVEL);
  gtk_container_add(GTK_CONTAINER(window), GTK_WIDGET(view));
  g_signal_connect(view, "load-failed-with-tls-errors", G_CALLBACK(tls_error), NULL);
  g_signal_connect(view, "load-failed", G_CALLBACK(load_failed), NULL);
  g_signal_connect(view, "load-changed", G_CALLBACK(loaded), NULL);
  gtk_widget_show_all(window);
  g_timeout_add_seconds(25, deadline, NULL);
  webkit_web_view_load_uri(view, argv[1]);
  gtk_main();
  gtk_widget_destroy(window);
  g_object_unref(context);
  return outcome;
}
