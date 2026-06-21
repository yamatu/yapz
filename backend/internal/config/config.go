package config

import "os"

type Config struct {
	Port        string
	DatabaseURL string
	JWTSecret   string
	CORSOrigin  string
	AdminEmail  string
	AdminUser   string
	AdminPass   string
}

func Load() Config {
	return Config{
		Port:        env("PORT", "8080"),
		DatabaseURL: env("DATABASE_URL", "postgres://yapz:yapz@localhost:5432/yapz?sslmode=disable"),
		JWTSecret:   env("JWT_SECRET", "dev-change-me"),
		CORSOrigin:  env("CORS_ORIGIN", "http://localhost:3000"),
		AdminEmail:  env("ADMIN_EMAIL", "admin@yapz.local"),
		AdminUser:   env("ADMIN_USERNAME", "admin"),
		AdminPass:   env("ADMIN_PASSWORD", "Admin123456"),
	}
}

func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
