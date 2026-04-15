document.addEventListener('DOMContentLoaded', () => {
    
    // --- 1. DARK / LIGHT MODE TOGGLE ---
    const htmlEl = document.documentElement;
    const darkToggle = document.getElementById('darkToggle');
    const themeIcon = document.querySelector('.theme-switch i');

    // Init theme
    const savedTheme = localStorage.getItem('theme') || 'dark';
    htmlEl.setAttribute('data-bs-theme', savedTheme);
    if(darkToggle) {
        darkToggle.checked = savedTheme === 'dark';
        updateThemeIcon(savedTheme);
    }

    if(darkToggle) {
        darkToggle.addEventListener('change', (e) => {
            const newTheme = e.target.checked ? 'dark' : 'light';
            htmlEl.setAttribute('data-bs-theme', newTheme);
            localStorage.setItem('theme', newTheme);
            updateThemeIcon(newTheme);
            if (window.updateChartTheme) window.updateChartTheme(); // Redraw chart natively
            if (window.updateMapTiles) window.updateMapTiles();
        });
    }

    function updateThemeIcon(theme) {
        if(!themeIcon) return;
        if(theme === 'dark') {
            themeIcon.className = 'fa-solid fa-moon text-primary';
        } else {
            themeIcon.className = 'fa-solid fa-sun text-warning';
        }
    }

    // --- 2. LIVE CLOCK ---
    const clockEl = document.getElementById('live-clock');
    const dateEl = document.getElementById('current-date');
    
    function updateClock() {
        const now = new Date();
        if(clockEl) clockEl.textContent = now.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'});
        if(dateEl) dateEl.textContent = now.toLocaleDateString('en-US', {weekday: 'long', month: 'short', day: 'numeric'});
    }
    setInterval(updateClock, 1000);
    updateClock();

    // --- 3. GEOLOCATION ---
    const geoBtn = document.getElementById('geoBtn');
    if(geoBtn) {
        geoBtn.addEventListener('click', () => {
            const origHTML = geoBtn.innerHTML;
            geoBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Locating...';
            geoBtn.disabled = true;

            if ("geolocation" in navigator) {
                navigator.geolocation.getCurrentPosition(
                    (position) => {
                        document.getElementById('geoLat').value = position.coords.latitude;
                        document.getElementById('geoLon').value = position.coords.longitude;
                        document.getElementById('geoForm').submit();
                    },
                    (error) => {
                        alert("Geolocation failed or denied.");
                        geoBtn.innerHTML = origHTML;
                        geoBtn.disabled = false;
                    }
                );
            } else {
                alert("Geolocation is not supported by your browser.");
                geoBtn.innerHTML = origHTML;
                geoBtn.disabled = false;
            }
        });
    }

    // --- 4. UNIT CONVERSION ---
    const unitC = document.getElementById('unit-c');
    const unitF = document.getElementById('unit-f');
    const tempEls = document.querySelectorAll('.temp-value');
    
    const savedUnit = localStorage.getItem('tempUnit') || 'c';
    if(savedUnit === 'f' && unitF) {
        unitF.checked = true;
        convertToFahrenheit();
    }

    if(unitC && unitF) {
        unitC.addEventListener('change', () => { if(unitC.checked) { localStorage.setItem('tempUnit', 'c'); convertToCelsius(); }});
        unitF.addEventListener('change', () => { if(unitF.checked) { localStorage.setItem('tempUnit', 'f'); convertToFahrenheit(); }});
    }

    function convertToFahrenheit() {
        tempEls.forEach(el => {
            const cVal = parseFloat(el.getAttribute('data-c'));
            if(!isNaN(cVal)) el.textContent = Math.round((cVal * 9/5) + 32);
        });
    }

    function convertToCelsius() {
        tempEls.forEach(el => {
            const cVal = parseFloat(el.getAttribute('data-c'));
            if(!isNaN(cVal)) el.textContent = cVal;
        });
    }

    // --- 5. DASHBOARD SPECIFIC LOGIC ---
    if(window.WEATHER_DATA) {
        const { city, temp, weatherDesc, lat, lon, forecastDates, forecastTemps, api_key, sunrise, sunset, timezone } = window.WEATHER_DATA;

        // A. Dynamic Background Setup
        function applyDynamicBackground() {
            if(!weatherDesc) return;
            const desc = weatherDesc.toLowerCase();
            let themeClass = 'weather-clear'; 
            
            if(desc.includes('cloud') || desc.includes('haze') || desc.includes('mist')) themeClass = 'weather-clouds';
            else if(desc.includes('rain') || desc.includes('drizzle') || desc.includes('thunder')) themeClass = 'weather-rain';
            else if(desc.includes('snow')) themeClass = 'weather-snow';
            else if(desc.includes('clear')) themeClass = 'weather-clear';
            
            document.body.className = document.body.className.replace(/weather-\w+/g, '');
            document.body.classList.add(themeClass);
        }
        applyDynamicBackground();

        // B. Sunrise / Sunset Arc & Destination Clock
        if(sunrise && sunset && typeof timezone !== 'undefined') {
            
            // Format time using specific offsets to ignore local system time
            function formatTimeWithOffset(unixSec, tzOffsetSec) {
                // unixSec is UTC. 
                const date = new Date((unixSec + tzOffsetSec) * 1000);
                return date.toISOString().substr(11, 5); // returns HH:MM in 24hr or we can manual format
            }

            // Using pure Date manipulation for destination clock
            function updateDestinationClock() {
                const now = new Date();
                const utcMs = now.getTime() + (now.getTimezoneOffset() * 60000);
                const destDate = new Date(utcMs + (timezone * 1000));
                
                const clockEl = document.getElementById('dest-clock');
                if(clockEl) {
                    clockEl.textContent = destDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit', hour12: true});
                }
            }
            setInterval(updateDestinationClock, 1000);
            updateDestinationClock();

            // Set fixed Sunrise/Sunset string from destination's perspective
            document.getElementById('sunrise-time').textContent = formatTimeWithOffset(sunrise, timezone);
            document.getElementById('sunset-time').textContent = formatTimeWithOffset(sunset, timezone);

            // Calculate percentage of day passed at the destination
            const nowUnix = Math.floor(Date.now() / 1000);
            let percent = 0;
            
            if (nowUnix < sunrise) percent = 0; // Pre-dawn
            else if (nowUnix > sunset) percent = 100; // Post-dusk
            else {
                const totalDaylight = sunset - sunrise;
                const elapsed = nowUnix - sunrise;
                percent = (elapsed / totalDaylight) * 100;
            }
            
            const sunIcon = document.getElementById('sun-icon');
            if(sunIcon) {
                sunIcon.style.left = `${percent}%`;
                const heightY = -Math.abs(30 * Math.sin((percent / 100) * Math.PI)); // Arc curve
                sunIcon.style.transform = `translate(-50%, calc(50% + ${heightY}px))`;
                
                if (percent >= 100 || percent <= 0) {
                    sunIcon.classList.remove('fa-sun', 'text-warning');
                    sunIcon.classList.add('fa-moon', 'text-secondary');
                }
            }
        }

        // C. Leaflet Map with radar layer toggles
        const mapEl = document.getElementById('weatherMap');
        let tileLayerInstance = null;
        let radarLayer = null;

        if(mapEl) {
            const map = L.map('weatherMap', {zoomControl: false}).setView([20.5937, 78.9629], 5);
            L.control.zoom({ position: 'bottomright' }).addTo(map);

            window.updateMapTiles = () => {
                const isDark = document.documentElement.getAttribute('data-bs-theme') === 'dark';
                if(tileLayerInstance) map.removeLayer(tileLayerInstance);
                
                // Dark mode tiles vs Light mode tiles
                const tileUrl = isDark ? 
                    'https://cartodb-basemaps-{s}.global.ssl.fastly.net/dark_all/{z}/{x}/{y}.png' : 
                    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
                    
                tileLayerInstance = L.tileLayer(tileUrl, { attribution: '&copy; OSMap' }).addTo(map);
                if(radarLayer) radarLayer.bringToFront();
            };
            window.updateMapTiles();

            // Default Layer
            if(api_key) {
                radarLayer = L.tileLayer(`https://tile.openweathermap.org/map/precipitation_new/{z}/{x}/{y}.png?appid=${api_key}`, { opacity: 0.8 }).addTo(map);
            }

            // Bind Layer Toggles
            const radarBtns = document.querySelectorAll('.radar-btn');
            const radarTitle = document.getElementById('radar-title');
            radarBtns.forEach(btn => {
                btn.addEventListener('click', (e) => {
                    radarBtns.forEach(b => b.classList.remove('active'));
                    e.target.classList.add('active');
                    const layerName = e.target.getAttribute('data-layer');
                    radarTitle.innerHTML = e.target.getAttribute('data-title');
                    
                    if(radarLayer) map.removeLayer(radarLayer);
                    radarLayer = L.tileLayer(`https://tile.openweathermap.org/map/${layerName}/{z}/{x}/{y}.png?appid=${api_key}`, { opacity: 0.8 }).addTo(map);
                });
            });

            // Fly to city animation
            setTimeout(() => {
                map.flyTo([lat, lon], 10, { animate: true, duration: 2.0 });
                L.marker([lat, lon]).addTo(map)
                    .bindPopup(`<div class="text-center"><b>${city}</b><br><span class="fs-5">${temp}°C</span></div>`)
                    .openPopup();
            }, 500);
        }

        // D. Chart.js Init
        const ctx = document.getElementById('forecastChart');
        let forecastChart = null;

        if(ctx) {
            Chart.defaults.font.family = 'Outfit';
            
            window.updateChartTheme = () => {
                if(forecastChart) forecastChart.destroy();
                
                const isDark = document.documentElement.getAttribute('data-bs-theme') === 'dark';
                const gridColor = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';
                const textColor = isDark ? '#f8fafc' : '#2d3748'; // Higher contrast

                forecastChart = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: forecastDates,
                        datasets: [{
                            label: 'Avg Temperature (°C)',
                            data: forecastTemps,
                            borderColor: '#38bdf8',
                            backgroundColor: 'rgba(56, 189, 248, 0.2)',
                            borderWidth: 3,
                            pointBackgroundColor: '#8b5cf6',
                            pointBorderColor: '#fff',
                            pointHoverBackgroundColor: '#fff',
                            pointHoverBorderColor: '#8b5cf6',
                            pointRadius: 5,
                            pointHoverRadius: 8,
                            fill: true,
                            tension: 0.4
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { display: false },
                            tooltip: {
                                backgroundColor: isDark ? 'rgba(30, 41, 59, 1)' : 'rgba(255, 255, 255, 1)',
                                titleColor: textColor,
                                bodyColor: textColor,
                                padding: 12,
                                borderColor: gridColor,
                                borderWidth: 1,
                                displayColors: false,
                                callbacks: {
                                    label: function(context) {
                                        let v = context.parsed.y;
                                        if (localStorage.getItem('tempUnit') === 'f') v = Math.round((v * 9/5) + 32);
                                        return `Avg: ${v}°`;
                                    }
                                }
                            }
                        },
                        scales: {
                            x: { grid: { color: gridColor, drawBorder: false }, ticks: { color: textColor } },
                            y: { grid: { color: gridColor, drawBorder: false }, ticks: { color: textColor, callback: function(value) { return value + '°'; } } }
                        }
                    }
                });
            };
            window.updateChartTheme();
        }
    } else {
        window.updateChartTheme = () => {}; 
    }
});