from flask import Flask, render_template, request, redirect, session, flash, make_response
import requests
import mysql.connector
from datetime import datetime, timezone
from werkzeug.security import generate_password_hash, check_password_hash
from config import DB_CONFIG, API_KEY

# ---------------- APP INIT ----------------
app = Flask(__name__)
app.secret_key = "super_secure_weather_key"

# ---------------- DB CONNECTION ----------------
try:
    db = mysql.connector.connect(**DB_CONFIG)
    cursor = db.cursor(dictionary=True)
    print("Database connected")
except Exception as e:
    print("DB Error:", e)

# ---------------- HELPER: FORECAST PROCESSOR ----------------
def process_forecast(forecast_data):
    """Processes 3-hourly forecast data into daily summaries"""
    daily = {}
    for item in forecast_data['list']:
        # Extract date from dt_txt "YYYY-MM-DD HH:MM:SS"
        date_str = item['dt_txt'].split(' ')[0]
        temp = item['main']['temp']
        icon = item['weather'][0]['icon']
        
        if date_str not in daily:
            daily[date_str] = {
                'temps': [temp],
                'icon': icon # just use the first icon encountered for the day
            }
        else:
            daily[date_str]['temps'].append(temp)
    
    # Take up to 5 days, calculate min/max
    processed = []
    for date, data in sorted(daily.items())[:6]:  # API often gives 6 partial days
        temps = data['temps']
        dt_obj = datetime.strptime(date, "%Y-%m-%d")
        processed.append({
            'date': date,
            'day_name': dt_obj.strftime("%A"),
            'short_date': dt_obj.strftime("%b %d"),
            'min': round(min(temps), 1),
            'max': round(max(temps), 1),
            'avg': round(sum(temps)/len(temps), 1),
            'icon': data['icon']
        })
    # Remove today if we want pure future forecast, but often users like today's summary too.
    return processed

# ---------------- HOME ----------------
@app.route('/')
def home():
    if 'user_id' in session:
        return redirect('/dashboard')
    return render_template("index.html")

# ---------------- REGISTER ----------------
@app.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        name = request.form.get('name')
        email = request.form.get('email')
        password = request.form.get('password')
        
        if not name or not email or not password:
            flash("All fields are required!", "warning")
            return redirect('/register')
            
        hashed_password = generate_password_hash(password)
        
        try:
            cursor.execute(
                "INSERT INTO users (name, email, password) VALUES (%s, %s, %s)",
                (name, email, hashed_password)
            )
            db.commit()
            flash("Registration successful! Please log in.", "success")
            return redirect('/login')
        except mysql.connector.Error as err:
            flash("Email already exists or error occurred.", "danger")
            return redirect('/register')

    return render_template("register.html")

# ---------------- LOGIN ----------------
@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        email = request.form.get('email')
        password = request.form.get('password')
        
        cursor.execute("SELECT * FROM users WHERE email=%s", (email,))
        user = cursor.fetchone()

        if user and check_password_hash(user['password'], password):
            session['user_id'] = user['id']
            session['name'] = user['name']
            flash("Logged in successfully!", "success")
            return redirect('/dashboard')

        flash("Invalid email or password", "danger")

    return render_template("login.html")

# ---------------- DASHBOARD ----------------
@app.route('/dashboard', methods=['GET', 'POST'])
def dashboard():
    if 'user_id' not in session:
        flash("Please login to access the dashboard", "warning")
        return redirect('/login')

    # Defaults to None
    weather = None
    aqi = None
    pollution = None
    daily_forecast = []
    lat = None
    lon = None
    insights = []
    
    city = request.form.get('city')
    req_lat = request.form.get('lat')
    req_lon = request.form.get('lon')

    if request.method == 'POST' and (city or (req_lat and req_lon)):
        try:
            # 1. WEATHER URL
            if req_lat and req_lon:
                url = f"http://api.openweathermap.org/data/2.5/weather?lat={req_lat}&lon={req_lon}&appid={API_KEY}&units=metric"
            else:
                url = f"http://api.openweathermap.org/data/2.5/weather?q={city}&appid={API_KEY}&units=metric"
                
            res = requests.get(url).json()

            if res.get("cod") == 200:
                lat = res['coord']['lat']
                lon = res['coord']['lon']

                weather = {
                    "city": res['name'],
                    "country": res['sys'].get('country', ''),
                    "temp": round(res['main']['temp']),
                    "feels_like": round(res['main']['feels_like']),
                    "humidity": res['main']['humidity'],
                    "pressure": res['main']['pressure'],
                    "visibility": round(res.get('visibility', 10000) / 1000, 1), # convert to km
                    "timezone": res.get('timezone', 0), # Offset from UTC in seconds
                    "wind": res['wind']['speed'],
                    "icon": res['weather'][0]['icon'],
                    "desc": res['weather'][0]['description'].capitalize()
                }

                # 2. AQI
                aqi_data = requests.get(
                    f"http://api.openweathermap.org/data/2.5/air_pollution?lat={lat}&lon={lon}&appid={API_KEY}"
                ).json()

                aqi = aqi_data['list'][0]['main']['aqi'] # 1 to 5
                pollution = aqi_data['list'][0]['components']

                # 3. FORECAST
                forecast_data = requests.get(
                    f"http://api.openweathermap.org/data/2.5/forecast?lat={lat}&lon={lon}&appid={API_KEY}&units=metric"
                ).json()

                daily_forecast = process_forecast(forecast_data)
                
                # 4. SUNRISE / SUNSET
                sunrise = res['sys'].get('sunrise')
                sunset = res['sys'].get('sunset')

                # 5. AI INSIGHTS & WARDROBE ASSISTANT
                wardrobe = []
                
                if weather["temp"] >= 35:
                    insights.append({"type": "danger", "icon": "fa-fire", "text": "Extreme heat! Avoid staying outdoors during peak hours."})
                    wardrobe.append({"icon": "fa-glasses", "text": "UV sunglasses & light cotton clothes"})
                elif weather["temp"] <= 10:
                    insights.append({"type": "info", "icon": "fa-snowflake", "text": "Cold weather detected. Bundle up!"})
                    wardrobe.append({"icon": "fa-mitten", "text": "Heavy coat, gloves, and a beanie"})
                elif weather["temp"] > 10 and weather["temp"] < 20:
                    wardrobe.append({"icon": "fa-mask-ventilator", "text": "A light jacket or sweater"})
                else:
                    wardrobe.append({"icon": "fa-shirt", "text": "T-shirt and comfortable casuals"})
                
                # Precipitation check (using weather desc heuristic)
                if "rain" in weather["desc"].lower() or "drizzle" in weather["desc"].lower():
                    wardrobe.append({"icon": "fa-umbrella", "text": "Waterproof jacket or an umbrella"})
                elif "snow" in weather["desc"].lower():
                    wardrobe.append({"icon": "fa-boot", "text": "Waterproof snow boots"})

                if weather["wind"] > 10: # m/s
                    insights.append({"type": "warning", "icon": "fa-wind", "text": "Strong winds today. Secure loose objects."})
                    
                if aqi >= 4:
                    insights.append({"type": "danger", "icon": "fa-head-side-mask", "text": "Poor air quality! Wearing a mask is highly recommended."})
                    wardrobe.append({"icon": "fa-head-side-mask", "text": "N95/KN95 Pollution Mask"})
                elif aqi == 3:
                    insights.append({"type": "warning", "icon": "fa-smog", "text": "Moderate air quality. Sensitive groups should reduce outdoor exertion."})

                if weather["humidity"] > 85:
                    insights.append({"type": "warning", "icon": "fa-droplet", "text": "High humidity - it may feel hotter than the actual temperature."})
                
                # If no alerts, give a positive one
                if not insights:
                    insights.append({"type": "success", "icon": "fa-sun", "text": "Weather looks great! Perfect time to go outside."})

            else:
                flash(f"City not found: {res.get('message', 'Unknown error')}", "danger")

        except Exception as e:
            flash(f"Error fetching data to API: {e}", "danger")

    # ---------------- FAVORITES ----------------
    favorites = []
    try:
        cursor.execute(
            "SELECT id, city FROM favorites WHERE user_id=%s ORDER BY added_at DESC",
            (session['user_id'],)
        )
        favorites = cursor.fetchall()  # returns list of dicts: [{'id': 1, 'city': 'Pune'}, ...]
    except Exception as e:
        print("Fav Error:", e)

    return render_template(
        "dashboard.html",
        weather=weather,
        aqi=aqi,
        pollution=pollution,
        forecast=daily_forecast,
        favorites=favorites,
        lat=lat,
        lon=lon,
        insights=insights,
        wardrobe=wardrobe if weather else [],
        sunrise=sunrise if weather else None,
        sunset=sunset if weather else None,
        api_key=API_KEY
    )

# ---------------- SAVE FAVORITE ----------------
@app.route('/save/<city>')
def save(city):
    if 'user_id' not in session:
        return redirect('/login')
        
    try:
        cursor.execute(
            "INSERT INTO favorites (user_id, city) VALUES (%s, %s)",
            (session['user_id'], city)
        )
        db.commit()
        flash(f"{city} added to favorites!", "success")
    except mysql.connector.IntegrityError:
        flash(f"{city} is already in your favorites.", "info")
    except Exception as e:
        flash("Could not add to favorites.", "danger")

    return redirect('/dashboard')

# ---------------- REMOVE FAVORITE ----------------
@app.route('/remove_fav/<int:fav_id>')
def remove_fav(fav_id):
    if 'user_id' not in session:
        return redirect('/login')
    
    try:
        cursor.execute(
            "DELETE FROM favorites WHERE id=%s AND user_id=%s",
            (fav_id, session['user_id'])
        )
        db.commit()
        flash("Removed from favorites.", "success")
    except Exception as e:
        flash("Error removing favorite.", "danger")
        
    return redirect('/dashboard')

# ---------------- DOWNLOAD REPORT ----------------
@app.route('/download/<city>')
def download_report(city):
    if 'user_id' not in session:
        return redirect('/login')
        
    # Fetch data specifically for this city
    try:
        url = f"http://api.openweathermap.org/data/2.5/weather?q={city}&appid={API_KEY}&units=metric"
        res = requests.get(url).json()

        if res.get("cod") == 200:
            lat = res['coord']['lat']
            lon = res['coord']['lon']
            
            weather = {
                "city": res['name'],
                "country": res['sys'].get('country', ''),
                "temp": res['main']['temp'],
                "humidity": res['main']['humidity'],
                "wind": res['wind']['speed'],
                "desc": res['weather'][0]['description']
            }
            
            # AQI
            aqi_data = requests.get(
                f"http://api.openweathermap.org/data/2.5/air_pollution?lat={lat}&lon={lon}&appid={API_KEY}"
            ).json()
            aqi = aqi_data['list'][0]['main']['aqi']
            
            rendered_html = render_template('report.html', weather=weather, aqi=aqi, generation_time=datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
            
            response = make_response(rendered_html)
            response.headers["Content-Disposition"] = f"attachment; filename=weather_report_{city}.html"
            response.headers["Content-Type"] = "text/html"
            return response
        else:
            flash("Cannot generate report, city not found.", "danger")
            return redirect('/dashboard')
    except Exception as e:
        flash("Error generating report.", "danger")
        return redirect('/dashboard')

# ---------------- LOGOUT ----------------
@app.route('/logout')
def logout():
    session.clear()
    flash("You have been logged out.", "info")
    return redirect('/login')

# ---------------- RUN ----------------
if __name__ == "__main__":
    print("Starting flask server...")
    app.run(debug=True, port=5000)