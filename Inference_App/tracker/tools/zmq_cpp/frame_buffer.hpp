#pragma once
#include <map>
#include <opencv2/opencv.hpp>

class FrameBuffer {
    std::map<int, cv::Mat> _buf;
    int _max_size;

public:
    explicit FrameBuffer(int max_size = 30) : _max_size(max_size) {}

    void push(int frame_id, const cv::Mat& frame) {
        _buf[frame_id] = frame.clone();
        while ((int)_buf.size() > _max_size)
            _buf.erase(_buf.begin());
    }

    // Returns the frame for frame_id (clone), or empty Mat if not found.
    // oldest_id_out: frame_id of the oldest entry (for lag calculation).
    cv::Mat get(int frame_id, int& oldest_id_out) const {
        oldest_id_out = _buf.empty() ? -1 : _buf.begin()->first;
        auto it = _buf.find(frame_id);
        if (it == _buf.end()) return cv::Mat();
        return it->second.clone();
    }

    bool empty() const { return _buf.empty(); }
    int  size()  const { return (int)_buf.size(); }
};
