const axios = require('axios');

module.exports = async function (context) {
    const apiResp = await axios.get(process.env.wwfUrl)
    const vauhtiApiResp = await axios.get(process.env.vauhtisUrl)

    const latestDonation = vauhtiApiResp.data[vauhtiApiResp.data.length - 1];
    const latestDonationTimestamp = new Date(latestDonation.timestamp);

    for (const key in apiResp.data.entities) {
        const element = apiResp.data.entities[key];
        const timestamp = new Date(element.created_date);

        if (timestamp < latestDonationTimestamp) {
            continue
        } else if (timestamp.getTime() === latestDonationTimestamp.getTime()) {
            if (element.public_name === latestDonation.name && element.comment === latestDonation.message) {
                continue
            }
        }

        const donation = {
            timestamp: timestamp.toISOString(),
            name: element.public_name,
            message: element.comment || null,
            amount: element.amount
        }

        await axios.post(process.env.vauhtisUrl, donation, {
            auth: {
                username: process.env.vauhtisUsername,
                password: process.env.vauhtisPassword
            }
        });
    }
};