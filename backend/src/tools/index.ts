import { getProducts } from "./getProducts.js";
import { logger } from "../logger.js";

export const toolDefs = [
  {
    type: "function" as const,
    function: {
      name: "get_products",
      description:
        "Search the store catalog for products. Use this for ANY product fact: " +
        "names, prices, availability, variants, descriptions, or links. " +
        "Returns up to 5 matching products.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Free-text search query, e.g. 'grey 3-seat sofa' or 'oak dining table'.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
];

export async function executeTool(name: string, argsJson: string): Promise<string> {
  try {
    switch (name) {
      case "get_products": {
        let query = "";
        try {
          const parsed = JSON.parse(argsJson || "{}") as { query?: unknown };
          query = typeof parsed.query === "string" ? parsed.query : "";
        } catch {
          query = "";
        }
        const products = await getProducts(query);
        return JSON.stringify({ products });
      }
      default:
        logger.warn({ name }, "executeTool: unknown tool");
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err) {
    logger.error({ err, name }, "executeTool: failed");
    return JSON.stringify({ error: "Tool execution failed." });
  }
}
