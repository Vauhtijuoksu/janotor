import "jsr:@std/dotenv/load";

// Load environment variables at startup
const VAUHTIS_URL = Deno.env.get("VAUHTIS_URL");
const VAUHTIS_USERNAME = Deno.env.get("VAUHTIS_USERNAME");
const VAUHTIS_PASSWORD = Deno.env.get("VAUHTIS_PASSWORD");
const SITE_URL = Deno.env.get("SITE_URL");
const SITE_ID = Deno.env.get("SITE_ID");
const X_SITE_ID = Deno.env.get("X_SITE_ID");
const PER_PAGE = parseInt(Deno.env.get("PER_PAGE") || "60", 10);
const FETCH_INTERVAL = parseInt(Deno.env.get("FETCH_INTERVAL") || "10000", 10);

// Validate required environment variables
const requiredVars = [
    "VAUHTIS_URL",
    "VAUHTIS_USERNAME",
    "VAUHTIS_PASSWORD",
    "SITE_URL",
    "SITE_ID",
    "X_SITE_ID",
    "PER_PAGE",
];
const missingVars = requiredVars.filter(name => !Deno.env.get(name));

if (missingVars.length > 0) {
    console.error(`Error: Missing required environment variables: ${missingVars.join(", ")}`);
    Deno.exit(1);
}

const getTimestamp = () => new Date().toISOString();

const handleDonationData = async (url) => {
    // Fetch donations from external API and Vauhtijuoksu API
    let apiRespJson, vauhtiApiRespJson;
    
    try {
        const apiResp = await fetch(url, { headers: { "X-Site-Id": X_SITE_ID } });
        if (!apiResp.ok) {
            console.error(`[${getTimestamp()}] ❌ External API error: ${apiResp.status} ${apiResp.statusText} (${url})`);
            return false;
        }
        apiRespJson = await apiResp.json();
    } catch (error) {
        console.error(`[${getTimestamp()}] ❌ External API request failed: ${error.message}`);
        return false;
    }
    
    try {
        const vauhtiApiResp = await fetch(VAUHTIS_URL);
        if (!vauhtiApiResp.ok) {
            console.error(`[${getTimestamp()}] ❌ Vauhtijuoksu API error: ${vauhtiApiResp.status} ${vauhtiApiResp.statusText}`);
            return false;
        }
        vauhtiApiRespJson = await vauhtiApiResp.json();
    } catch (error) {
        console.error(`[${getTimestamp()}] ❌ Vauhtijuoksu API request failed: ${error.message}`);
        return false;
    }

    const donations = apiRespJson.data;

    let readNextPage = false;

    if (apiRespJson.data.length === PER_PAGE) {
        readNextPage = true;
    }

    // Process each donation
    for (const d of donations) {
        const existing = vauhtiApiRespJson.find(e => e.external_id === d.id.toString());
        // Skip donations we already have, but on first page patch in late-arriving message
        if (existing) {
            if (d.message && (!existing.message || existing.message !== d.message)) {
                try {
                    console.log(`[${getTimestamp()}] 📨 Patching message for donation #${d.id}: ${d.message}`);
                    const patchResp = await fetch(`${VAUHTIS_URL}/${existing.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({
                            message: d.message
                        }),
                        headers: {
                            "Content-Type": "application/json",
                            "Authorization": "Basic " + btoa(VAUHTIS_USERNAME + ":" + VAUHTIS_PASSWORD)
                        }
                    });
                    if (patchResp.ok) {
                        console.log(`[${getTimestamp()}] ✏️ Updated message for donation #${d.id}: ${d.message}`);
                    } else {
                        console.error(`[${getTimestamp()}] ❌ Failed to update message for donation #${d.id}: ${patchResp.status} ${patchResp.statusText}`);
                    }
                } catch (err) {
                    console.error(`[${getTimestamp()}] ❌ Network error updating message for donation #${d.id}: ${err.message}`);
                }
            }
            readNextPage = false;
            continue;
        }

        const donation = {
            timestamp: d.created_at,
            name: d.name || 'Anonyymi',
            message: d.message || null,
            amount: d.amount,
            external_id: d.id.toString()
        };

        try {
            const result = await fetch(VAUHTIS_URL, {
                method: "POST",
                body: JSON.stringify(donation),
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": "Basic " + btoa(VAUHTIS_USERNAME + ":" + VAUHTIS_PASSWORD)
                }
            });
            
            if (result.ok) {
                console.log(`[${getTimestamp()}] ✅ Successfully added donation #${d.id}`);
            }

            if (!result.ok) {
                console.error(`[${getTimestamp()}] ❌ Failed to add donation #${d.id}: ${result.status} ${result.statusText}`);
            }
        } catch (err) {
            console.error(`[${getTimestamp()}] ❌ Network error adding donation #${d.id}: ${err.message}`);
        }
    }

    return readNextPage;
};

const main = async () => {
	const readNextPage = await handleDonationData(
		`${SITE_URL}/actions/${SITE_ID}/donations?per_page=${PER_PAGE}`
    );
    if (readNextPage) {
        let page = 2;
        while (true) {
			const readNextPage = await handleDonationData(
				`${SITE_URL}/actions/${SITE_ID}/donations?per_page=${PER_PAGE}&page=${page}`
            );
            if (!readNextPage) {
                break;
            }
            page++;
        }
    }
};

if (import.meta.main) {
    console.log(`[${getTimestamp()}] Starting donation fetcher, will run every ${FETCH_INTERVAL/1000} seconds`);
    
    // Run main immediately once
    main().catch(console.error);
    
    // Then set up interval to run using the configured interval
    setInterval(() => {
        main().catch(console.error);
    }, FETCH_INTERVAL);
}