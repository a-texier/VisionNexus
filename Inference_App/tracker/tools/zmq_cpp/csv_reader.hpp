#pragma once
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

struct MetaRow {
    double az;   // azimut (radians)
    double el;   // elevation (radians)
    double chh;  // FOV horizontal (degres)
};

static std::vector<std::string> split_csv_line(const std::string& line) {
    std::vector<std::string> tokens;
    std::stringstream ss(line);
    std::string tok;
    while (std::getline(ss, tok, ',')) {
        if (!tok.empty() && tok.back() == '\r') tok.pop_back();
        tokens.push_back(tok);
    }
    return tokens;
}

static int find_col(const std::vector<std::string>& headers, const std::string& name) {
    for (int i = 0; i < (int)headers.size(); ++i)
        if (headers[i] == name) return i;
    return -1;
}

static std::vector<MetaRow> load_csv(const std::string& path, double& fps_out) {
    std::ifstream f(path);
    if (!f.is_open()) {
        fprintf(stderr, "[csv] ERREUR : impossible d'ouvrir %s\n", path.c_str());
        exit(1);
    }

    std::string basename = path;
    {
        auto p = basename.rfind('/');
        if (p != std::string::npos) basename = basename.substr(p + 1);
        p = basename.rfind('\\');
        if (p != std::string::npos) basename = basename.substr(p + 1);
    }

    const bool  use_fov1     = (basename.find("TV") != std::string::npos);
    const char* fov_col_name = use_fov1 ? "fov_deg_1" : "fov_deg_0";
    printf("[csv] '%s' -> colonne FOV : %s\n", basename.c_str(), fov_col_name);

    std::string header_line;
    std::getline(f, header_line);
    auto headers = split_csv_line(header_line);

    int col_az    = find_col(headers, "az");
    int col_el    = find_col(headers, "el");
    int col_fov   = find_col(headers, fov_col_name);
    int col_delta = find_col(headers, "delta_ms");

    if (col_az < 0 || col_el < 0) {
        fprintf(stderr, "[csv] ERREUR : colonnes 'az' ou 'el' introuvables\n");
        exit(1);
    }
    if (col_fov < 0)
        fprintf(stderr, "[csv] AVERT : colonne '%s' introuvable -> chh=0.0\n", fov_col_name);

    std::vector<MetaRow> rows;
    std::string line;
    double last_delta_ms = 0.0;

    while (std::getline(f, line)) {
        if (line.empty() || line[0] == '\r') continue;
        auto toks = split_csv_line(line);
        MetaRow r;
        try {
            r.az  = (col_az  >= 0 && col_az  < (int)toks.size()) ? std::stod(toks[col_az])  : 0.0;
            r.el  = (col_el  >= 0 && col_el  < (int)toks.size()) ? std::stod(toks[col_el])  : 0.0;
            r.chh = (col_fov >= 0 && col_fov < (int)toks.size()) ? std::stod(toks[col_fov]) : 0.0;
            if (col_delta >= 0 && col_delta < (int)toks.size())
                last_delta_ms = std::stod(toks[col_delta]);
        } catch (...) { continue; }
        rows.push_back(r);
    }

    fps_out = 0.0;
    if (rows.size() > 1 && last_delta_ms > 0.0)
        fps_out = static_cast<double>(rows.size() - 1) * 1000.0 / last_delta_ms;

    printf("[csv] %zu lignes chargees  fps_csv=%.2f\n", rows.size(), fps_out);
    return rows;
}
