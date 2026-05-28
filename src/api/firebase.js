const axios = require('axios');

/**
 * Fetches users from Firebase and filters them by role.
 * @param {string} role - The role to filter by (e.g., 'employee')
 * @returns {Promise<string[]>} List of user names
 */
async function getEmployeesByRole(role = 'employee') {
    try {
        const url = 'https://db-images-adm-default-rtdb.firebaseio.com/7db-adm/users.json';
        const response = await axios.get(url);
        const data = response.data;

        if (!data) return [];

        const employees = [];
        
        // Iterate through categories (e.g., admin, others)
        for (const category in data) {
            const users = data[category];
            for (const username in users) {
                if (users[username].role === role) {
                    employees.push(username);
                }
            }
        }

        return employees;
    } catch (error) {
        console.error('Error fetching employees from Firebase:', error.message);
        return [];
    }
}

module.exports = {
    getEmployeesByRole
};
