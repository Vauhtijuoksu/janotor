import "jsr:@std/dotenv/load";

const handleDonationData = async (url) => {
    const apiResp = await fetch(url);
    const apiRespJson = await apiResp.json();
    const vauhtiApiResp = await fetch(Deno.env.get("VAUHTIS_URL") || "");
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

        const result = await fetch(Deno.env.get("VAUHTIS_URL") || "", {
            method: "POST",
            body: JSON.stringify(donation),
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Basic " + btoa((Deno.env.get("VAUHTIS_USERNAME") || "") + ":" + (Deno.env.get("VAUHTIS_PASSWORD") || ""))
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
        `${Deno.env.get("SITE_URL")}/api/${Deno.env.get("SITE_ID")}/donations`
    );

    if (knownDonations === 0) {
        let page = 2;
        while (true) {
            const knownDonations = await handleDonationData(
                `${Deno.env.get("SITE_URL")}/api/${Deno.env.get("SITE_ID")}/donations?page=${page}`
            );
            if (knownDonations.length !== 0) {
                break;
            }
            page++;
        }
    }
};

if (import.meta.main) {
    console.log("Starting donation fetcher, will run every 10 seconds");
    
    // Run main immediately once
    main().catch(console.error);
    
    // Then set up interval to run every 10 seconds
    setInterval(() => {
        main().catch(console.error);
    }, 10000);
}