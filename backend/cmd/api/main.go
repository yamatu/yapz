package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"yapz/backend/internal/config"
	"yapz/backend/internal/database"
	"yapz/backend/internal/httpapi"
	"yapz/backend/internal/realtime"
	"yapz/backend/internal/store"
)

func main() {
	cfg := config.Load()

	db, err := database.Connect(context.Background(), cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("database: %v", err)
	}
	defer db.Close()
	if err := database.ApplyMigrations(context.Background(), db, "migrations"); err != nil {
		log.Fatalf("migrations: %v", err)
	}

	st := store.New(db)
	if err := st.EnsureAdmin(context.Background(), cfg.AdminUser, cfg.AdminEmail, cfg.AdminPass); err != nil {
		log.Fatalf("admin seed: %v", err)
	}
	hub := realtime.NewHub(st)
	go hub.Run()

	server := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           httpapi.NewRouter(cfg, st, hub),
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		log.Printf("api listening on http://localhost:%s", cfg.Port)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = server.Shutdown(ctx)
}
