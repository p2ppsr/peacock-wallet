#include <gio/gio.h>
#include <stdio.h>
#include <string.h>
#include <signal.h>

static void configure_test_ca(GSocketClient *client, GSocketClientEvent event,
                              GSocketConnectable *target, GIOStream *stream, gpointer database) {
  (void)client; (void)target;
  if (event == G_SOCKET_CLIENT_TLS_HANDSHAKING)
    g_tls_connection_set_database(G_TLS_CONNECTION(stream), G_TLS_DATABASE(database));
}

/* Only the local CI fixture is contacted; this executable never loads wallet code. */
int main(int argc, char **argv) {
  if (argc != 5) return 2;
  signal(SIGPIPE, SIG_IGN);
  setvbuf(stdout, NULL, _IONBF, 0);
  GError *error = NULL;
  GProxyResolver *resolver = g_proxy_resolver_get_default();
  printf("resolver=%s\n", G_OBJECT_TYPE_NAME(resolver));
  gchar **routes = g_proxy_resolver_lookup(resolver, argv[1], NULL, &error);
  if (error || !routes || g_strcmp0(routes[0], argv[3]) != 0) {
    fprintf(stderr, "Configured proxy was not selected: %s (%s)\n", routes ? routes[0] : "none", error ? error->message : "no lookup error");
    return 1;
  }
  g_strfreev(routes);

  GSocketClient *client = g_socket_client_new();
  g_socket_client_set_timeout(client, 10);
  g_socket_client_set_tls(client, TRUE);
  gboolean reject = strcmp(argv[4], "reject") == 0;
  GTlsDatabase *database = NULL;
  if (!reject) {
    database = g_tls_file_database_new(argv[2], &error);
    if (error || !database) return 1;
    g_signal_connect(client, "event", G_CALLBACK(configure_test_ca), database);
  }
  /* Exercise GIO proxy negotiation and normal TLS verification directly.
     The separate full-AppImage WebKit test qualifies the HTTP engine. */
  GSocketConnection *connection = g_socket_client_connect_to_uri(client, argv[1], 443, NULL, &error);
  if (reject) {
    if (connection || !g_error_matches(error, G_TLS_ERROR, G_TLS_ERROR_BAD_CERTIFICATE)) {
      fprintf(stderr, "Untrusted TLS certificate was not rejected: %s\n", error ? error->message : "no TLS error");
      return 1;
    }
    puts("untrusted TLS certificate rejected");
  } else {
    if (error || !connection) {
      fprintf(stderr, "Trusted HTTPS connection failed: %s\n", error ? error->message : "no connection");
      return 1;
    }
    const gchar request[] = "GET /healthz HTTP/1.1\r\nHost: peacock-proxy.invalid\r\nConnection: close\r\n\r\n";
    GOutputStream *output = g_io_stream_get_output_stream(G_IO_STREAM(connection));
    if (!g_output_stream_write_all(output, request, strlen(request), NULL, NULL, &error)) return 1;
    GDataInputStream *input = g_data_input_stream_new(g_io_stream_get_input_stream(G_IO_STREAM(connection)));
    gchar *status = g_data_input_stream_read_line(input, NULL, NULL, &error);
    gboolean healthy = !error && status &&
      (g_str_has_prefix(status, "HTTP/1.0 200 ") || g_str_has_prefix(status, "HTTP/1.1 200 "));
    g_free(status);
    g_object_unref(input);
    if (!healthy) { fprintf(stderr, "Trusted HTTPS request did not return 200\n"); return 1; }
    puts("proxied HTTPS status=200");
  }
  g_clear_error(&error);
  if (connection) g_object_unref(connection);
  if (database) g_object_unref(database);
  g_object_unref(client);
  return 0;
}
