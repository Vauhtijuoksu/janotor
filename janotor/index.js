const axios = require('axios');

module.exports = async function (context) {
    const apiResp = await axios.get(process.env.wwfUrl)
    const vauhtiApiResp = await axios.get(process.env.vauhtisUrl)

    const promises = [];
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
};