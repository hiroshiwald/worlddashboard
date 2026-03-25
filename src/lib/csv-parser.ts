import fs from "fs";
import { DashboardSource } from "./types";

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        fields.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
  }
  fields.push(current.trim());
  return fields;
}

function determineStatus(
  type: string,
  url: string
): "live" | "static" | "unknown" {
  const typeLower = type.toLowerCase();
  const urlLower = url.toLowerCase();

  if (
    typeLower.includes("static") ||
    urlLower === "static dataset" ||
    typeLower === "library"
  ) {
    return "static";
  }

  if (url.startsWith("http") || url.startsWith("https")) {
    return "live";
  }

  return "unknown";
}

export function parseCsvFile(filePath: string): DashboardSource[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n").filter((line) => line.trim().length > 0);

  // Skip header row
  const dataLines = lines.slice(1);

  return dataLines.map((line) => {
    const fields = parseCSVLine(line);
    const id = parseInt(fields[0] || "0", 10);
    const name = fields[1] || "";
    const category = fields[2] || "";
    const type = fields[3] || "";
    const tier = fields[4] || "";
    const url = fields[5] || "";
    const notes = fields[6] || "";

    return {
      id,
      name,
      category,
      type,
      tier,
      url,
      notes,
      status: determineStatus(type, url),
    };
  });
}
