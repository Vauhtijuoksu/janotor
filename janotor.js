// Load environment variables at startup
const VAUHTIS_URL = process.env.VAUHTIS_URL;
const VAUHTIS_USERNAME = process.env.VAUHTIS_USERNAME;
const VAUHTIS_PASSWORD = process.env.VAUHTIS_PASSWORD;
const BETTERNOW_KEY = process.env.BETTERNOW_KEY;
const FRONTEND_API_URL = process.env.FRONTEND_API_URL || "https://frontend-api.kentaa.nl";
const PER_PAGE = parseInt(process.env.PER_PAGE || "60", 10);
const FETCH_INTERVAL = parseInt(process.env.FETCH_INTERVAL || "10000", 10);
const DRY_RUN = process.argv.includes("--dry-run");
// Read at start rather than imported, so a compiled binary uses the charity ids of the environment it runs in
const charities = await Bun.file(process.env.CHARITIES_FILE || "charities.json").json();

// Validate required environment variables
const requiredVars = [
    "VAUHTIS_URL",
    "VAUHTIS_USERNAME",
    "VAUHTIS_PASSWORD",
    "BETTERNOW_KEY",
];
const missingVars = requiredVars.filter(name => !process.env[name]);

if (missingVars.length > 0) {
    console.error(`Error: Missing required environment variables: ${missingVars.join(", ")}`);
    process.exit(1);
}

const vauhtisAuth = "Basic " + btoa(VAUHTIS_USERNAME + ":" + VAUHTIS_PASSWORD);

const getTimestamp = () => new Date().toISOString();

const get = async (url, headers) => {
    const resp = await fetch(url, { headers });
    if (!resp.ok) {
        throw new Error(`External API error: ${resp.status} ${resp.statusText} (${url})`);
    }
    return resp;
};

// Each source fetches one page of donations, newest first, and returns the cursor for the next page or null
const sources = {
    iraiser: async (charity, next) => {
        const url = next || `${FRONTEND_API_URL}/actions/${charity.action}/donations?per_page=${PER_PAGE}`;
        const json = await (await get(url, { "X-Site-Id": charity.site })).json();
        return {
            donations: json.data.map(d => ({
                id: d.id,
                timestamp: d.created_at,
                name: d.name,
                message: d.message,
                amount: parseFloat(d.amount),
            })),
            next: json.links.next || null,
        };
    },
    securycast: async (charity, next) => {
        const page = next || 1;
        const json = await (await get(`${charity.url}?page=${page}&maxItems=100`)).json();
        // Securycast donations have no id, so build one that stays the same between runs.
        // Identical donations in the same second do happen, so they are numbered within the page.
        // An identical pair split over two pages is added once until both are on the same page
        const seen = {};
        return {
            donations: (json.items || []).map(d => {
                const key = `${d.created}|${d.name}|${d.amount}`;
                seen[key] = (seen[key] || 0) + 1;
                return {
                    id: `${key}|${seen[key]}`,
                    timestamp: d.created,
                    name: d.name,
                    message: d.greeting,
                    amount: d.amount,
                };
            }),
            next: page < json.maxPages ? page + 1 : null,
        };
    },
    betternow: async (charity, next) => {
        const resp = await get(`https://api.betternow.org/fundraisers/${charity.fundraiser}/donations`, {
            "Accept": "application/vnd.betternow+json; version=1",
            "Authorization": "Basic " + btoa(charity.email + ":" + BETTERNOW_KEY),
            ...(next && { "Range": next, "Range-Unit": "items" }),
        });
        const json = resp.status === 204 ? [] : await resp.json();
        return {
            donations: json.map(d => ({
                id: d.id,
                timestamp: d.created_at,
                name: d.name,
                message: d.comment,
                amount: d.amount.cents / 100,
            })),
            next: resp.status === 206 ? resp.headers.get("Next-Range") : null,
        };
    },
};

// Adds new donations and fills in messages added later. Tells if an already synced donation was found and if all requests succeeded
const syncDonations = async (charity, donations, vauhtiApiRespJson) => {
    let foundExisting = false;
    let ok = true;

    for (const d of donations) {
        // The API stores external ids as strings, BetterNow sends numbers
        const existing = vauhtiApiRespJson.find(e => e.external_id === String(d.id));
        if (existing) {
            foundExisting = true;
            // Only null means the message hasn't arrived yet. An empty message was cleared on purpose, e.g. in the admin panel
            if (d.message && existing.message == null) {
                if (DRY_RUN) {
                    console.log(`[${getTimestamp()}] 🏜️ Would patch message for ${charity.name} donation ${d.id}: ${d.message}`);
                } else {
                    try {
                        console.log(`[${getTimestamp()}] 📨 Patching message for ${charity.name} donation ${d.id}: ${d.message}`);
                        const patchResp = await fetch(`${VAUHTIS_URL}/${existing.id}`, {
                            method: "PATCH",
                            body: JSON.stringify({ message: d.message }),
                            headers: {
                                "Content-Type": "application/json",
                                "Authorization": vauhtisAuth
                            }
                        });
                        if (patchResp.ok) {
                            console.log(`[${getTimestamp()}] ✏️ Updated message for ${charity.name} donation ${d.id}: ${d.message}`);
                        } else {
                            ok = false;
                            console.error(`[${getTimestamp()}] ❌ Failed to update message for ${charity.name} donation ${d.id}: ${patchResp.status} ${patchResp.statusText}`);
                        }
                    } catch (err) {
                        ok = false;
                        console.error(`[${getTimestamp()}] ❌ Network error updating message for ${charity.name} donation ${d.id}: ${err.message}`);
                    }
                }
            }
            continue;
        }

        const donation = {
            timestamp: d.timestamp,
            name: d.name || 'Anonyymi',
            message: d.message || null,
            amount: d.amount,
            external_id: String(d.id),
            charity: charity.charity
        };

        if (DRY_RUN) {
            console.log(`[${getTimestamp()}] 🏜️ Would add ${charity.name} donation ${d.id}: ${donation.name} ${donation.amount}€`);
        } else {
            try {
                const result = await fetch(VAUHTIS_URL, {
                    method: "POST",
                    body: JSON.stringify(donation),
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": vauhtisAuth
                    }
                });

                if (result.ok) {
                    // Pages can shift while paging, so remember the donation in case it shows up again during this run
                    vauhtiApiRespJson.push(await result.json());
                    console.log(`[${getTimestamp()}] ✅ Successfully added ${charity.name} donation ${d.id}`);
                } else {
                    ok = false;
                    console.error(`[${getTimestamp()}] ❌ Failed to add ${charity.name} donation ${d.id}: ${result.status} ${result.statusText}`);
                }
            } catch (err) {
                ok = false;
                console.error(`[${getTimestamp()}] ❌ Network error adding ${charity.name} donation ${d.id}: ${err.message}`);
            }
        }
    }

    return { foundExisting, ok };
};

// Normally paging stops at the first already synced donation. After a start or a failure all pages are checked,
// so donations missed while the script was down or failing get synced too.
const needsFullSync = new Set(charities);

const syncCharity = async (charity, vauhtiApiRespJson) => {
    const fullSync = needsFullSync.has(charity);
    let allOk = true;
    let next = null;
    do {
        const page = await sources[charity.type](charity, next);
        const { foundExisting, ok } = await syncDonations(charity, page.donations, vauhtiApiRespJson);
        allOk &&= ok;
        if (foundExisting && !fullSync) break;
        next = page.next;
    } while (next);

    if (allOk) {
        needsFullSync.delete(charity);
    } else {
        needsFullSync.add(charity);
    }
};

const main = async () => {
    let vauhtiApiRespJson;
    if (DRY_RUN) {
        vauhtiApiRespJson = [];
    } else {
        try {
            const vauhtiApiResp = await fetch(VAUHTIS_URL);
            if (!vauhtiApiResp.ok) {
                console.error(`[${getTimestamp()}] ❌ Vauhtijuoksu API error: ${vauhtiApiResp.status} ${vauhtiApiResp.statusText}`);
                return;
            }
            vauhtiApiRespJson = await vauhtiApiResp.json();
        } catch (error) {
            console.error(`[${getTimestamp()}] ❌ Vauhtijuoksu API request failed: ${error.message}`);
            return;
        }
    }

    for (const charity of charities) {
        try {
            await syncCharity(charity, vauhtiApiRespJson);
        } catch (err) {
            needsFullSync.add(charity);
            console.error(`[${getTimestamp()}] ❌ ${charity.name}: ${err.message}`);
        }
    }
};

if (import.meta.main) {
    console.log(`[${getTimestamp()}] Starting donation fetcher, will run every ${FETCH_INTERVAL/1000} seconds`);

    // Wait for each run to finish before the next one, so a slow full sync can't add the same donations twice
    while (true) {
        await main().catch(console.error);
        await Bun.sleep(FETCH_INTERVAL);
    }
}
