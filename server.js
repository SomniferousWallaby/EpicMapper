// server.js
const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const session = require('express-session');

require('dotenv').config();

const app = express();
app.set('trust proxy', 1); // required for secure cookies behind Cloud Run's load balancer
const PORT = process.env.PORT || 8123;
const ADMIN_EMAILS = process.env.ADMIN_EMAILS;

// --- Session Store Setup ---
// Uses Redis if REDIS_URL is set, otherwise falls back to in-memory (fine for single-instance/dev)
async function buildSessionStore() {
    if (process.env.REDIS_URL) {
        const { default: RedisStore } = require('connect-redis');
        const { createClient } = require('redis');
        const redisClient = createClient({ url: process.env.REDIS_URL });
        await redisClient.connect();
        console.log('Using Redis session store');
        return new RedisStore({ client: redisClient });
    }
    console.warn('No REDIS_URL set — using in-memory session store. Sessions will not persist across restarts.');
    return undefined; // express-session defaults to MemoryStore
}

app.use(express.json());
app.use(cors({
    origin: process.env.CORS_ORIGIN,
    credentials: true
}));
app.use(express.static('public'));

// Session middleware placeholder — filled in before app.listen, so it's always set when requests arrive
let _sessionMiddleware;
app.use((req, res, next) => _sessionMiddleware(req, res, next));

// --- Oauth ---
const JIRA_CLIENT_ID = process.env.JIRA_CLIENT_ID;
const JIRA_CLIENT_SECRET = process.env.JIRA_CLIENT_SECRET;
const JIRA_REDIRECT_URI = process.env.JIRA_REDIRECT_URI;
const SCOPES = 'read:jira-work read:jira-user offline_access';


// --- Auth Middleware ---
function requireAuth(req, res, next) {
    if (!req.session.jira || !req.session.jira.accessToken) {
        return res.status(401).json({ error: 'Not authenticated. Please log in with Jira.' });
    }
    next();
}

// --- Auth Routes ---
app.get('/auth/jira', (req, res) => {
    req.session.oauthState = req.sessionID;

    const authorizationUrl = `https://auth.atlassian.com/authorize?` +
        `audience=api.atlassian.com&` +
        `client_id=${JIRA_CLIENT_ID}&` +
        `scope=${encodeURIComponent(SCOPES)}&` +
        `redirect_uri=${encodeURIComponent(JIRA_REDIRECT_URI)}&` +
        `state=${req.session.oauthState}&` +
        `response_type=code&` +
        `prompt=consent`;

    req.session.save((err) => {
        if (err) return res.status(500).send('Session save failed');
        res.redirect(authorizationUrl);
    });
});

app.get('/auth/jira/callback', async (req, res) => {
    const { code, state } = req.query;
    if (state !== req.session.oauthState) {
        return res.status(403).send("Invalid state parameter. Possible CSRF attack.");
    }
    try {
        const tokenResponse = await fetch('https://auth.atlassian.com/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: JIRA_CLIENT_ID,
                client_secret: JIRA_CLIENT_SECRET,
                code: code,
                grant_type: 'authorization_code',
                redirect_uri: JIRA_REDIRECT_URI
            })
        });
        const tokenData = await tokenResponse.json();

        if (!tokenData.access_token) throw new Error("No access token in response");

        const resourcesRes = await fetch('https://api.atlassian.com/oauth/token/accessible-resources', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
        });
        const resourcesData = await resourcesRes.json();
        const cloudID = resourcesData[0].id;
        const instanceUrl = resourcesData[0].url;

        const meRes = await fetch('https://api.atlassian.com/me', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
        });
        const meData = await meRes.json();

        req.session.jira = {
            accessToken: tokenData.access_token,
            refreshToken: tokenData.refresh_token,
            cloudID: cloudID,
            apiUrl: `https://api.atlassian.com/ex/jira/${cloudID}`,
            instanceUrl: instanceUrl,
            userEmail: meData.email || ''
        };

        res.redirect('/');
    } catch (error) {
        console.error("Oauth Error", error);
        res.status(500).send("Authentication Failed");
    }
});

app.get('/auth/logout', (req, res) => {
    req.session.destroy(() => {
        res.clearCookie('connect.sid');
        res.redirect('/');
    });
});

app.get('/api/auth/status', (req, res) => {
    if (req.session.jira && req.session.jira.accessToken) {
        res.json({ authenticated: true, instanceUrl: req.session.jira.instanceUrl });
    } else {
        res.json({ authenticated: false });
    }
});

// --- Helper Functions ---

//TODO: check expiration and use session.jira.refreshToken to get a new session token if needed
async function getValidToken(session) {
    return session.jira.accessToken;
}

/**
 * Fetches all fields from Jira to find the specific custom field ID for Story Points.
 */
async function getStoryPointAndSkillFieldId(jiraUrl, headers) {
    const fieldUrl = `${jiraUrl}/rest/api/3/field`;
    try {
        const response = await fetch(fieldUrl, { headers });
        if (!response.ok) {
            console.info("Could not fetch Jira fields to find Story Point ID. Displayed size for each story will be set to 1.");
            return null;
        }
        const fields = await response.json();
        console.debug("Fetched fields from Jira:", fields);
        // Find the story point field. Tries 'Story Points' and 'Story Point Estimate'.
        const storyPointField = fields.find(field =>
            field.custom && (field.name.toUpperCase() === 'STORY POINTS' || field.name.toUpperCase() === 'STORY POINT ESTIMATE')
        );
        const skillField = fields.find(field =>
            field.custom && (field.name.toUpperCase() === 'SKILL' || field.name.toUpperCase() === 'SKILLS')
        );
        return [storyPointField ? storyPointField.id : null, skillField ? skillField.id : null];
    } catch (error) {
        console.error("Error trying to find Story Point field:", error);
        return null;
    }
}

/**
 * Executes a Jira search query.
 * Dynamically includes the story point field in the request.
 */
async function executeJiraSearch(jql, storyPointFieldId, skillFieldId, jiraUrl, headers) {
    const searchUrl = `${jiraUrl}/rest/api/3/search/jql`;
    
    // Base fields we always want
    const requestFields = ["summary", "status", "issuetype", "assignee", "issuelinks", "parent"];
    // Dynamically add the story point field if it was found
    if (storyPointFieldId) {
        requestFields.push(storyPointFieldId);
    }
    if (skillFieldId) {
        requestFields.push(skillFieldId);
    }

    try {
        const apiResponse = await fetch(searchUrl, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                jql: jql,
                fields: requestFields,
                maxResults: 100 
            })
        });
        const data = await apiResponse.json();
        console.debug('Searching Jira with JQL:', jql);
        console.debug('Jira search response:', data);
        if (data.errorMessages) console.error('Jira errorMessages:', data.errorMessages);
        if (data.warningMessages) console.warn('Jira warningMessages:', data.warningMessages);
        return { ok: apiResponse.ok, status: apiResponse.status, data };
    } catch (error) {
        console.error("PROXY FETCH FAILED - FULL ERROR:", error); 
        return { ok: false, status: 500, data: { error: 'Proxy to Jira fetch failed', details: error } };
    }
}


// Proxy Routes
app.get('/api/search/epics', requireAuth, async (req, res) => {
    const q = (req.query.q || '').trim();
    if (q.length < 2) return res.json({ epics: [] });

    const token = await getValidToken(req.session);
    const jiraUrl = req.session.jira.apiUrl;
    const headers = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    };

    const safeQ = q.replace(/"/g, '\\"');
    const jql = `issuetype = Epic AND text ~ "${safeQ}" ORDER BY updated DESC`;

    try {
        const response = await fetch(`${jiraUrl}/rest/api/3/search/jql`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ jql, fields: ['summary', 'status', 'project'], maxResults: 10 })
        });
        const data = await response.json();
        if (!response.ok) return res.status(response.status).json({ error: 'Search failed' });
        const epics = (data.issues || []).map(i => ({
            key: i.key,
            summary: i.fields.summary,
            project: i.fields.project?.name || ''
        }));
        res.json({ epics });
    } catch (err) {
        res.status(500).json({ error: 'Search failed' });
    }
});

app.post('/api/jira', requireAuth, async (req, res) => {
    const { epicKeys } = req.body;
    console.debug('Received request with:', req.body);

    if (!epicKeys) {
        return res.status(400).json({ error: 'Missing Epic Key.' });
    }

    const token = await getValidToken(req.session);
    const jiraUrl = req.session.jira.apiUrl;
    const headers = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    };

    try {
        // Find the story point field ID for the Jira instance
        const [storyPointFieldId, skillFieldId] = await getStoryPointAndSkillFieldId(jiraUrl, headers);
        if (storyPointFieldId) {
             console.debug(`Discovered Story Point Field ID: ${storyPointFieldId}`);
        } else {
             console.info("Could not find a Story Point field. Nodes will not be sized by points.");
        }
        if (skillFieldId) {
             console.debug(`Discovered Skill Field ID: ${skillFieldId}`);
        } else {
             console.info("Could not find a Skill field. Skill data will not be included.");
        }

        const epicKeysJQL = epicKeys.map(key => `"${key}"`).join(', ');
        
        // Team-Managed JQL
        const jqlTeamManaged = `parent in (${epicKeysJQL}) OR key in (${epicKeysJQL})`;
        let result = await executeJiraSearch(jqlTeamManaged, storyPointFieldId, skillFieldId, jiraUrl, headers);
        
        if (result.ok && result.data.issues && result.data.issues.length > 1) {
            console.info("Using Team-Managed JQL results.");
            return res.status(200).json({ issues: result.data.issues, storyPointFieldId: storyPointFieldId, skillFieldId: skillFieldId});
        }
        
        // Company-Managed JQL
        const jqlCompanyManaged = `'Epic Link' in (${epicKeysJQL}) OR key in (${epicKeysJQL})`;
        result = await executeJiraSearch(jqlCompanyManaged, storyPointFieldId, skillFieldId, jiraUrl, headers);

        if (result.ok) {
            console.info("Using Company-Managed JQL results.");
            return res.status(200).json({ issues: result.data.issues, storyPointFieldId: storyPointFieldId, skillFieldId: skillFieldId});
        } else {
            const errorMessage = result.data.errorMessages ? result.data.errorMessages.join(' ') : JSON.stringify(result.data);
            return res.status(result.status).json({ error: `Jira API Error: ${errorMessage}` });
        }

    } catch (error) {
        console.error('Proxy server error:', error);
        res.status(500).json({ error: 'An unexpected error occurred in the proxy server.' });
    }
});

app.post('/api/developers', requireAuth, async (req, res) => {
    const token = await getValidToken(req.session);
    const jiraUrl = req.session.jira.apiUrl;
    const userEmail = req.session.jira.userEmail;

    const isAdmin = ADMIN_EMAILS && ADMIN_EMAILS.includes(userEmail);

    const headers = {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/json",
        "Content-Type": "application/json"
    };

    try {
        const jql = 'status CHANGED TO (closed, "QA Accepted", "QA Not Needed") DURING (-30d, now())';

        // Get Story Point field ID
        const fieldRes = await fetch(`${jiraUrl}/rest/api/3/field`, { headers });
        if (!fieldRes.ok) {
            const errorData = await fieldRes.json();
            return res.status(fieldRes.status).json({ error: "Failed to fetch Jira fields.", details: errorData });
        }
        const fields = await fieldRes.json();
        const storyPointField = fields.find(f =>
            f.custom && (
                f.name.toLowerCase().includes('story point') ||
                f.name.toLowerCase().includes('story point estimate')
            )
        );
        const storyPointFieldId = storyPointField ? storyPointField.id : null;
        
        if (!storyPointFieldId) {
            return res.status(404).json({ error: "Could not find a 'Story Point' custom field in your Jira instance." });
        }

        // Fetch issues
        let allIssues = [];
        let nextPageToken = null;

        do {
            const searchBody = {
                jql: jql,
                fields: ["assignee", storyPointFieldId],
                maxResults: 100,
                ...(nextPageToken && { nextPageToken: nextPageToken })
            };
            
            const searchRes = await fetch(`${jiraUrl}/rest/api/3/search/jql`, {
                method: "POST",
                headers: headers,
                body: JSON.stringify(searchBody)
            });

            const data = await searchRes.json();
            if (!searchRes.ok) {
                console.error("Jira API Error:", JSON.stringify(data, null, 2));
                return res.status(searchRes.status).json({ error: "Jira API search failed.", details: data });
            }
            
            allIssues = allIssues.concat(data.issues);
            nextPageToken = data.nextPageToken;

        } while (nextPageToken);
        console.log(`Fetched a total of ${allIssues.length} issues.`);

        // Group by assignee and sum story points
        const devMap = {};
        for (const issue of allIssues) {
            const assignee = issue.fields.assignee;
            if (!assignee) continue;
            
            const points = issue.fields[storyPointFieldId] || 0;
            
            if (!devMap[assignee.accountId]) {
                devMap[assignee.accountId] = {
                    name: assignee.displayName,
                    accountId: assignee.accountId,
                    email: assignee.emailAddress || "",
                    velocity: 0
                };
            }
            devMap[assignee.accountId].velocity += points;
        }

        const devs = Object.values(devMap).filter(dev => dev.velocity > 0);
        res.json({ 
            developers: devs, 
            isUserAdmin: isAdmin 
        });

    } catch (error) {
        console.error("Server error:", error);
        res.status(500).json({ error: "An internal server error occurred." });
    }
});

(async () => {
    const store = await buildSessionStore().catch(err => {
        console.error('Failed to connect to Redis:', err);
        process.exit(1);
    });

    _sessionMiddleware = session({
        store,
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: process.env.NODE_ENV === 'production',
            httpOnly: true,
            maxAge: 1000 * 60 * 60 * 24
        }
    });

    app.listen(PORT, () => {
        console.log(`Server is running at http://localhost:${PORT}`);
    });
})();
