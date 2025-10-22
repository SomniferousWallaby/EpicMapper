# Epic Mapper

Epic Mapper is a web-based tool designed to map the complex dependencies of issues within one or more Jira epics. It provides interactive graph and Gantt chart views to help teams understand task relationships, identify blockers, and forecast project completion timelines based on historical developer velocity.


## Features

* **Interactive Dependency Graph**: Visualize how stories, tasks, and bugs are interconnected.
* **Gantt Chart View**: See the critical path and project timeline based on blocking dependencies.
* **Data-Driven Estimation**: Calculate project completion dates using developer velocity and skill-based allocations.
* **Role-Based Views**: Sensitive velocity data is hidden from non-admin users.

---

## Prerequisites

Before you begin, ensure you have [Node.js](https://nodejs.org/) (version 16 or later) installed on your machine. This includes `npm`, the Node.js package manager.

---

## Installation & Running

Follow these steps to get the application running on your local machine.

1.  **Clone the Repository**
    Open your terminal, navigate to where you want to store the project, and run the following command:
    ```bash
    git clone [https://github.com/SomniferousWallaby/jiragraph](https://github.com/SomniferousWallaby/jiragraph)
    cd your-repo-name
    ```

2.  **Install Dependencies**
    This command reads the `package.json` file and installs all the necessary packages for the server.
    ```bash
    npm install
    ```

3.  **Start the Server**
    This will run the backend proxy server, which is required for the application to communicate with the Jira API. By default, it runs on `http://localhost:8123`.
    ```bash
    npm start
    ```
    You should see a confirmation message in your terminal: `Server is running at http://localhost:8123`.

4.  **Open the Application**
    Navigate to the `public/` folder within the project and open the **`index.html`** file in your web browser.


You can now use the application by filling in your Jira credentials and an Epic Key.
