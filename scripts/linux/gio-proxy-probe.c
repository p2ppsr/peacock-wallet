#include <gio/gio.h>
#include <libsoup/soup.h>
#include <stdio.h>
#include <string.h>

/* Only the local CI fixture is contacted; this executable never loads wallet code. */
int main(int argc, char **argv) {
  if (argc != 5) return 2;
  GError *error = NULL;
  GProxyResolver *resolver = g_proxy_resolver_get_default();
  printf("resolver=%s\n", G_OBJECT_TYPE_NAME(resolver));
  gchar **routes = g_proxy_resolver_lookup(resolver, argv[1], NULL, &error);
  if (error || !routes || g_strcmp0(routes[0], argv[3]) != 0) {
    fprintf(stderr, "Configured proxy was not selected: %s (%s)\n", routes ? routes[0] : "none", error ? error->message : "no lookup error");
    return 1;
  }
  g_strfreev(routes);

  SoupSession *session = soup_session_new_with_options("timeout", 10, NULL);
  gboolean reject = strcmp(argv[4], "reject") == 0;
  if (!reject) {
    GTlsDatabase *database = g_tls_file_database_new(argv[2], &error);
    if (error || !database) return 1;
    soup_session_set_tls_database(session, database);
    g_object_unref(database);
  }
  SoupMessage *message = soup_message_new("GET", argv[1]);
  GBytes *response = soup_session_send_and_read(session, message, NULL, &error);
  if (reject) {
    if (response || !g_error_matches(error, G_TLS_ERROR, G_TLS_ERROR_BAD_CERTIFICATE)) {
      fprintf(stderr, "Untrusted TLS certificate was not rejected: %s\n", error ? error->message : "no TLS error");
      return 1;
    }
    puts("untrusted TLS certificate rejected");
  } else {
    if (error || !response || soup_message_get_status(message) != 200) {
      fprintf(stderr, "Trusted HTTPS request failed: %s\n", error ? error->message : "non-200 status");
      return 1;
    }
    puts("proxied HTTPS status=200");
  }
  g_clear_error(&error);
  if (response) g_bytes_unref(response);
  g_object_unref(message);
  g_object_unref(session);
  return 0;
}
