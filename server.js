// server.js

const adminEmails = require ('./adminUsers.js');
const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = 8123;
const ADMIN_EMAILS = adminEmails.adminEmails;

app.use(express.json());
app.use(cors());
app.use(express.static('public')); 

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
 * Helper function to execute a Jira search query.
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
app.post('/api/jira', async (req, res) => {
    const { jiraUrl, email, apiToken, epicKeys } = req.body;
    console.debug('Received request with:', req.body);

    if (!jiraUrl || !email || !apiToken || !epicKeys) {
        return res.status(400).json({ error: 'Missing required Jira credentials or Epic Key.' });
    }

    const headers = {
        'Authorization': `Basic ${Buffer.from(`${email}:${apiToken}`).toString('base64')}`,
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

app.post('/api/developers', async (req, res) => {
    const { jiraUrl, email, apiToken } = req.body;
    if (!jiraUrl || !email || !apiToken) {
        return res.status(400).json({ error: "Missing Jira credentials." });
    }

    const isAdmin = ADMIN_EMAILS.includes(email);

    const headers = {
        "Authorization": "Basic " + Buffer.from(`${email}:${apiToken}`).toString("base64"),
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

app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});
