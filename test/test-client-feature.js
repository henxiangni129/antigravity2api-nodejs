import { sendClientFeature } from "../src/api/client.js";
import tokenManager from "../src/auth/token_manager.js";

const token = await tokenManager.getToken();
await sendClientFeature(token);
