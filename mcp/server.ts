// stdio entry: `node mcp/dist/server.js`. The host starts it with cwd = the plugin folder, and sets
// ZEN_PLUGIN_FILES (the files it may read) and ZEN_PLUGIN_DATA (a folder for its settings).
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './app.ts';

await createServer().connect(new StdioServerTransport());
