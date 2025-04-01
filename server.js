const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');
const protobuf = require('protobufjs');
const fs = require('fs');
const csv = require('csv-parse');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files from the 'public' folder
app.use(express.static('public'));

// Set EJS as the view engine
app.set('view engine', 'ejs');

// Load the GTFS-realtime proto file
const protoFile = 'gtfs-realtime.proto';
const root = protobuf.loadSync(protoFile);
const FeedMessage = root.lookupType('transit_realtime.FeedMessage');

// API endpoint
const url = 'https://otd.delhi.gov.in/api/realtime/VehiclePositions.pb?key=7pnJf5w6MCh0JWrdisnafk0YhnKfUqxx';

let busData = []; // Store the latest bus data
let busStops = []; // Store bus stop data from CSV

// Function to parse CSV data
const parseCSV = (csvString) => {
    return new Promise((resolve, reject) => {
        const stops = [];
        
        csv.parse(csvString, {
            columns: true,
            skip_empty_lines: true
        })
        .on('data', (row) => {
            stops.push({
                name: row.stop_name || 'Unknown Stop',
                latitude: parseFloat(row.stop_lat),
                longitude: parseFloat(row.stop_lon)
            });
        })
        .on('end', () => {
            resolve(stops);
        })
        .on('error', (err) => {
            reject(err);
        });
    });
};

// Read the CSV file from the 'data' folder
const csvFilePath = 'data/stops.csv';
const csvString = fs.readFileSync(csvFilePath, 'utf8');

// Parse CSV data once on server start
parseCSV(csvString).then(stops => {
    busStops = stops;
    console.log(`Parsed ${busStops.length} bus stops from CSV`);
}).catch(err => {
    console.error('Error parsing CSV:', err);
});

// Fetch and parse vehicle position data
const fetchBusData = async () => {
    try {
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        const buffer = response.data;
        const message = FeedMessage.decode(new Uint8Array(buffer));
        const data = FeedMessage.toObject(message, {
            longs: String,
            enums: String,
            bytes: String,
        });

        busData = data.entity
            .filter(entity => entity.vehicle && entity.vehicle.position)
            .map(entity => ({
                busNo: entity.vehicle.vehicle.id || 'Unknown',
                routeNo: entity.vehicle.trip?.routeId || 'Unknown',
                latitude: entity.vehicle.position.latitude,
                longitude: entity.vehicle.position.longitude,
            }));

        console.log(`Fetched ${busData.length} buses`);

        // Emit the updated bus data and bus stops to all connected clients
        io.emit('busUpdate', { buses: busData, busStops });
    } catch (error) {
        console.error('Error fetching bus data:', error.message);
    }
};

// Fetch data every 1 second (1000ms)
setInterval(fetchBusData, 1000);

// Serve the webpage
app.get('/', (req, res) => {
    res.render('index', { buses: busData, busStops });
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    fetchBusData(); // Initial fetch when server starts
});