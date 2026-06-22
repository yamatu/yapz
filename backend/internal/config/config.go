package config

import "os"

type Config struct {
	Port             string
	DatabaseURL      string
	JWTSecret        string
	CORSOrigin       string
	AdminEmail       string
	AdminUser        string
	AdminPass        string
	UploadDir        string
	StorageDriver    string
	S3Endpoint       string
	S3Region         string
	S3Bucket         string
	S3AccessKey      string
	S3SecretKey      string
	RTCICEURLs       string
	RTCICEUsername   string
	RTCICECredential string
}

func Load() Config {
	return Config{
		Port:             env("PORT", "8080"),
		DatabaseURL:      env("DATABASE_URL", "postgres://yapz:yapz@localhost:5432/yapz?sslmode=disable"),
		JWTSecret:        env("JWT_SECRET", "dev-change-me"),
		CORSOrigin:       env("CORS_ORIGIN", "http://localhost:3000"),
		AdminEmail:       env("ADMIN_EMAIL", "admin@yapz.local"),
		AdminUser:        env("ADMIN_USERNAME", "admin"),
		AdminPass:        env("ADMIN_PASSWORD", "Admin123456"),
		UploadDir:        env("UPLOAD_DIR", "uploads"),
		StorageDriver:    env("STORAGE_DRIVER", "local"),
		S3Endpoint:       env("S3_ENDPOINT", ""),
		S3Region:         env("S3_REGION", "garage"),
		S3Bucket:         env("S3_BUCKET", "yapz-images"),
		S3AccessKey:      env("S3_ACCESS_KEY_ID", ""),
		S3SecretKey:      env("S3_SECRET_ACCESS_KEY", ""),
		RTCICEURLs:       env("RTC_ICE_URLS", "stun:stun.l.google.com:19302"),
		RTCICEUsername:   env("RTC_ICE_USERNAME", ""),
		RTCICECredential: env("RTC_ICE_CREDENTIAL", ""),
	}
}

func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
