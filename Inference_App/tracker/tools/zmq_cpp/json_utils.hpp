#pragma once
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
#include "csv_reader.hpp"

static std::string make_meta_json(const MetaRow& r, int frame_id) {
    char buf[256];
    snprintf(buf, sizeof(buf),
        "{\"az\":%.9f,\"el\":%.9f,\"chh\":%.4f,\"frame_id\":%d}",
        r.az, r.el, r.chh, frame_id);
    return std::string(buf);
}

static int parse_int_field(const std::string& json, const char* key) {
    std::string search = std::string("\"") + key + "\":";
    auto pos = json.find(search);
    if (pos == std::string::npos) return -1;
    pos += search.size();
    while (pos < json.size() && (json[pos] == ' ' || json[pos] == '\t')) ++pos;
    return atoi(json.c_str() + pos);
}

struct BBox {
    int x1, y1, x2, y2;
    int b, g, r;
    std::string label;
};

static std::vector<BBox> parse_boxes(const std::string& json) {
    std::vector<BBox> boxes;
    auto arr_start = json.find("\"boxes\":");
    if (arr_start == std::string::npos) return boxes;
    arr_start = json.find('[', arr_start);
    if (arr_start == std::string::npos) return boxes;

    size_t pos = arr_start + 1;
    while (pos < json.size()) {
        auto obj_start = json.find('{', pos);
        if (obj_start == std::string::npos) break;
        auto obj_end   = json.find('}', obj_start);
        if (obj_end   == std::string::npos) break;

        std::string obj = json.substr(obj_start, obj_end - obj_start + 1);
        BBox box;
        box.x1 = parse_int_field(obj, "x1");
        box.y1 = parse_int_field(obj, "y1");
        box.x2 = parse_int_field(obj, "x2");
        box.y2 = parse_int_field(obj, "y2");
        box.b  = parse_int_field(obj, "b");
        box.g  = parse_int_field(obj, "g");
        box.r  = parse_int_field(obj, "r");

        auto lpos = obj.find("\"label\":\"");
        if (lpos != std::string::npos) {
            lpos += 9;
            auto lend = obj.find('"', lpos);
            if (lend != std::string::npos)
                box.label = obj.substr(lpos, lend - lpos);
        }
        boxes.push_back(box);
        pos = obj_end + 1;
    }
    return boxes;
}
