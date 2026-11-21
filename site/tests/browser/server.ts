// Keep each browser run on the checkout that started its static server.
export const port = Number(process.env.NAGHVA_TEST_PORT ?? 4322);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('NAGHVA_TEST_PORT must be a port number from 1 to 65535');
}
export const localOrigin = `http://127.0.0.1:${port}`;
