import "jsr:@std/dotenv/load";

// Load environment variables at startup
const VAUHTIS_URL = Deno.env.get("VAUHTIS_URL");
const VAUHTIS_USERNAME = Deno.env.get("VAUHTIS_USERNAME");
const VAUHTIS_PASSWORD = Deno.env.get("VAUHTIS_PASSWORD");
const SITE_URL = Deno.env.get("SITE_URL");
const SITE_ID = Deno.env.get("SITE_ID");
const FETCH_INTERVAL = parseInt(Deno.env.get("FETCH_INTERVAL") || "10000", 10);

// Validate required environment variables
const requiredVars = ["VAUHTIS_URL", "VAUHTIS_USERNAME", "VAUHTIS_PASSWORD", "SITE_URL", "SITE_ID"];
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
        const apiResp = await fetch(url);
        if (!apiResp.ok) {
            console.error(`[${getTimestamp()}] ❌ External API error: ${apiResp.status} ${apiResp.statusText} (${url})`);
            return -1;
        }
        apiRespJson = await apiResp.json();
    } catch (error) {
        console.error(`[${getTimestamp()}] ❌ External API request failed: ${error.message}`);
        return -1;
    }
    
    try {
        const vauhtiApiResp = await fetch(VAUHTIS_URL);
        if (!vauhtiApiResp.ok) {
            console.error(`[${getTimestamp()}] ❌ Vauhtijuoksu API error: ${vauhtiApiResp.status} ${vauhtiApiResp.statusText}`);
            return -1;
        }
        vauhtiApiRespJson = await vauhtiApiResp.json();
    } catch (error) {
        console.error(`[${getTimestamp()}] ❌ Vauhtijuoksu API request failed: ${error.message}`);
        return -1;
    }

    const promises = [];
    const donations = apiRespJson.data;

    let knownDonations = 0;

    // If we already have all donations, no need to process
    if (vauhtiApiRespJson.length === apiRespJson.total) {
        return -1;
    }

    if (!apiRespJson.next_page_url) {
        // Break the loop, last page
        knownDonations = -1;
    }

    // Process each donation
    for await (const d of donations) {
        // Skip donations we already have
        if (vauhtiApiRespJson.some(e => e.external_id === d.id.toString())) {
            knownDonations++;
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
            
            if (!result.ok) {
                console.error(`[${getTimestamp()}] ❌ Failed to add donation #${d.id}: ${result.status} ${result.statusText}`);
            }
            promises.push(result);
        } catch (err) {
            console.error(`[${getTimestamp()}] ❌ Network error adding donation #${d.id}: ${err.message}`);
        }
    }

    await Promise.all(promises);
    
    return knownDonations;
};

const main = async () => {
    const knownDonations = await handleDonationData(
        `${SITE_URL}/api/${SITE_ID}/donations`
    );
    if (knownDonations === 0) {
        let page = 2;
        while (true) {
            const knownDonations = await handleDonationData(
                `${SITE_URL}/api/${SITE_ID}/donations?page=${page}`
            );
            if (knownDonations.length !== 0) {
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