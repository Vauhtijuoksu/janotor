const axios = require('axios');

module.exports = async function (context) {
    const knownDonations = await handleDonationData(`${process.env.siteUrl}/api/${process.env.siteId}/donations`) 

    if (knownDonations.length === 0) {
        let page = 2
        while (true) {
            const knownDonations = await handleDonationData(`${process.env.siteUrl}/api/${process.env.siteId}/donations?page=${page}`)
            if (knownDonations.length !== 0) {
                break
            }
            page++
        }
    }
};

const handleDonationData = async (url) => {
    const apiResp = await axios.get(url) 
    const vauhtiApiResp = await axios.get(process.env.vauhtisUrl)

    const promises = [];
    const donations = apiResp.data

    if (vauhtiApiResp.data.length === apiResp.total) {
        context.log('No new donations')
        return
    }

    let knownDonations = 0

    if (!apiResp.next_page_url) {
        // Break the loop, last page
        knownDonations = 1
    }

    for await (const d of donations) {
        if (vauhtiApiResp.data.some(e => e.external_id === d.id)) {
            knownDonations++
            continue
        }

        const donation = {
            timestamp: d.created_at.toISOString(),
            name: d.name || 'Anonyymi',
            message: d.message || null,
            amount: d.amount,
            external_id: d.id
        }

        const result = axios.post(process.env.vauhtisUrl, donation, {
            auth: {
                username: process.env.vauhtisUsername,
                password: process.env.vauhtisPassword
            }
        }).catch(err => {
            context.log(err);
        });
        promises.push(result);
        context.log(`Added donation with id ${id}`)
    }

    await Promise.all(promises);

    return knownDonations
}