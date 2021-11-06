const axios = require('axios');

module.exports = async function (context) {
    const apiResp = await axios.get(process.env.wwfUrl)
    const vauhtiApiResp = await axios.get(process.env.vauhtisUrl)

    const keys = Object.keys(apiResp.data.entities)
    for await (const id of keys) {
        if (vauhtiApiResp.data.some(e => e.external_id === id)) {
            continue
        }

        const element = apiResp.data.entities[id];
        const timestamp = new Date(element.created_date);

        const donation = {
            timestamp: timestamp.toISOString(),
            name: element.public_name || 'Anonyymi',
            message: element.comment || null,
            amount: element.amount,
            external_id: id
        }

        axios.post(process.env.vauhtisUrl, donation, {
            auth: {
                username: process.env.vauhtisUsername,
                password: process.env.vauhtisPassword
            }
        });
        context.log(`Added donation with id ${id}`)
    }
};