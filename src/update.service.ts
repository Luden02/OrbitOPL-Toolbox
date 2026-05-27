import PackageInfo from "../package.json";

const REPO = "Luden02/OrbitOPL-Toolbox";
const RELEASES_URL = `https://api.github.com/repos/${REPO}/releases?per_page=10`;

export interface UpdateCheckResult {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion?: string;
  releaseUrl?: string;
  releaseName?: string;
  /** Populated when the check itself failed (offline, rate-limited, etc.). */
  error?: string;
}

/** Strips a leading "v" and splits into [core, prerelease]. */
function parseVersion(raw: string): { parts: number[]; pre: string } {
  const cleaned = raw.trim().replace(/^v/i, "");
  const [core, ...preParts] = cleaned.split("-");
  const parts = core.split(".").map((n) => parseInt(n, 10) || 0);
  while (parts.length < 3) parts.push(0);
  return { parts, pre: preParts.join("-") };
}

/**
 * Returns true if `candidate` is a newer version than `current`.
 * Compares the numeric core first; if equal, a build *without* a prerelease
 * tag, or with a lexically-greater one, is considered newer.
 */
export function isNewerVersion(candidate: string, current: string): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  for (let i = 0; i < 3; i++) {
    if (a.parts[i] > b.parts[i]) return true;
    if (a.parts[i] < b.parts[i]) return false;
  }
  // Equal core. No prerelease ranks above any prerelease.
  if (a.pre === b.pre) return false;
  if (!a.pre) return true;
  if (!b.pre) return false;
  return a.pre.localeCompare(b.pre) > 0;
}

export async function checkForUpdates(): Promise<UpdateCheckResult> {
  const currentVersion = PackageInfo.version;
  try {
    const response = await fetch(RELEASES_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "OrbitOPL-Toolbox",
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub responded with ${response.status}`);
    }

    const releases = (await response.json()) as Array<{
      tag_name: string;
      name: string;
      html_url: string;
      draft: boolean;
    }>;

    // GitHub returns releases newest-first; take the first published one
    // (prereleases/betas included, since this project ships them).
    const latest = releases.find((r) => !r.draft);
    if (!latest) {
      return { updateAvailable: false, currentVersion };
    }

    const latestVersion = latest.tag_name.replace(/^v/i, "");
    return {
      updateAvailable: isNewerVersion(latest.tag_name, currentVersion),
      currentVersion,
      latestVersion,
      releaseUrl: latest.html_url,
      releaseName: latest.name || latest.tag_name,
    };
  } catch (error: any) {
    console.error("Update check failed:", error?.message || error);
    return {
      updateAvailable: false,
      currentVersion,
      error: error?.message || String(error),
    };
  }
}
