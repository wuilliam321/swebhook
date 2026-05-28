const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

let db;

/**
 * Initializes the Firebase Admin SDK if not already initialized.
 */
function initializeFirebase() {
    if (db) return db;

    try {
        let credential;
        const serviceAccountEnv = process.env.FIREBASE_SERVICE_ACCOUNT;
        const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || path.resolve(__dirname, '../../service-account-firebase.json');

        if (serviceAccountEnv) {
            // Load from environment variable (JSON string)
            credential = admin.credential.cert(JSON.parse(serviceAccountEnv));
        } else if (fs.existsSync(serviceAccountPath)) {
            // Load from file
            credential = admin.credential.cert(serviceAccountPath);
        } else {
            throw new Error('No Firebase credentials found (env FIREBASE_SERVICE_ACCOUNT or file service-account-firebase.json)');
        }
        
        admin.initializeApp({
            credential,
            databaseURL: 'https://db-images-adm-default-rtdb.firebaseio.com'
        });

        db = admin.database();
        return db;
    } catch (error) {
        console.error('Error initializing Firebase Admin:', error.message);
        return null;
    }
}

/**
 * Fetches users from Firebase and filters them by role.
 * @param {string} role - The role to filter by (e.g., 'employee')
 * @returns {Promise<string[]>} List of user names
 */
async function getEmployeesByRole(role = 'employee') {
    const database = initializeFirebase();
    if (!database) return [];

    try {
        const usersRef = database.ref('7db-adm/users');
        const snapshot = await usersRef.once('value');
        const data = snapshot.val();

        if (!data) return [];

        const employees = [];
        
        // data contains usernames directly under '7db-adm/users'
        for (const username in data) {
            const user = data[username];
            if (user && user.role === role) {
                employees.push(username);
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
