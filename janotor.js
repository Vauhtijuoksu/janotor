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

const handleDonationData = async (url) => {
    const apiResp = await fetch(url);
    const apiRespJson = await apiResp.json();
    const vauhtiApiResp = await fetch(VAUHTIS_URL);
    const vauhtiApiRespJson = await vauhtiApiResp.json();

    const promises = [];
    const donations = apiRespJson.data;

    if (vauhtiApiRespJson.length === apiRespJson.total) {
        return;
    }

    let knownDonations = 0;

    if (!apiRespJson.next_page_url) {
        // Break the loop, last page
        knownDonations = 1;
    }

    for await (const d of donations) {
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

        const result = await fetch(VAUHTIS_URL, {
            method: "POST",
            body: JSON.stringify(donation),
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Basic " + btoa(VAUHTIS_USERNAME + ":" + VAUHTIS_PASSWORD)
            }
        }).catch(err => {
            console.error(err);
        });
        promises.push(result);
        console.log(`Added donation with id ${d.id}`);
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
    console.log(`Starting donation fetcher, will run every ${FETCH_INTERVAL/1000} seconds`);
    
    // Run main immediately once
    main().catch(console.error);
    
    // Then set up interval to run using the configured interval
    setInterval(() => {
        main().catch(console.error);
    }, FETCH_INTERVAL);
}