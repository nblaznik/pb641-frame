#include <cerrno>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <sstream>
#include <string>

#include <inkview.h>
#include <sys/stat.h>

static const char* CONFIG_PATH = "/mnt/ext1/system/config/pb641-frame.cfg";
static const char* IMAGE_DIR = "/mnt/ext1/My pictures/PB641Frame";
static const char* IMAGE_PATH = "/mnt/ext1/My pictures/PB641Frame/latest.jpg";
static const char* TEMP_IMAGE_PATH = "/mnt/ext1/My pictures/PB641Frame/latest.tmp";
static const char* REVISION_PATH = "/mnt/ext1/system/state/pb641-frame.revision";
static const char* POLL_TIMER = "pb641-frame-poll";
static const int DEFAULT_POLL_SECONDS = 300;
static const int DOWNLOAD_TIMEOUT_SECONDS = 30;
static const int MAX_IMAGE_BYTES = 8 * 1024 * 1024;

static ifont* title_font = NULL;
static ifont* body_font = NULL;
static bool image_is_visible = false;
static bool poll_in_progress = false;
static int poll_seconds = DEFAULT_POLL_SECONDS;

struct Config {
    std::string server_url;
    std::string token;
    int interval_seconds;

    Config() : interval_seconds(DEFAULT_POLL_SECONDS) {}
};

static std::string trim(const std::string& value)
{
    const std::string whitespace = " \t\r\n";
    const std::string::size_type first = value.find_first_not_of(whitespace);
    if (first == std::string::npos) {
        return "";
    }
    const std::string::size_type last = value.find_last_not_of(whitespace);
    return value.substr(first, last - first + 1);
}

static bool read_text_file(const char* path, std::string* output)
{
    std::ifstream input(path, std::ios::in | std::ios::binary);
    if (!input) {
        return false;
    }
    std::ostringstream contents;
    contents << input.rdbuf();
    *output = trim(contents.str());
    return true;
}

static bool write_text_file(const char* path, const std::string& value)
{
    std::ofstream output(path, std::ios::out | std::ios::binary | std::ios::trunc);
    if (!output) {
        return false;
    }
    output << value << "\n";
    return output.good();
}

static bool write_binary_file(const char* path, const void* data, int size)
{
    std::ofstream output(path, std::ios::out | std::ios::binary | std::ios::trunc);
    if (!output) {
        return false;
    }
    output.write(static_cast<const char*>(data), size);
    return output.good();
}

static std::string url_encode(const std::string& value)
{
    static const char HEX[] = "0123456789ABCDEF";
    std::string encoded;
    for (std::string::const_iterator it = value.begin(); it != value.end(); ++it) {
        const unsigned char c = static_cast<unsigned char>(*it);
        if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
            (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.' || c == '~') {
            encoded += static_cast<char>(c);
        } else {
            encoded += '%';
            encoded += HEX[c >> 4];
            encoded += HEX[c & 15];
        }
    }
    return encoded;
}

static bool load_config(Config* config, std::string* error)
{
    std::ifstream input(CONFIG_PATH);
    if (!input) {
        *error = std::string("Configuration not found:\n") + CONFIG_PATH;
        return false;
    }

    std::string line;
    while (std::getline(input, line)) {
        line = trim(line);
        if (line.empty() || line[0] == '#') {
            continue;
        }
        const std::string::size_type separator = line.find('=');
        if (separator == std::string::npos) {
            continue;
        }
        const std::string key = trim(line.substr(0, separator));
        const std::string value = trim(line.substr(separator + 1));
        if (key == "server_url") {
            config->server_url = value;
        } else if (key == "token") {
            config->token = value;
        } else if (key == "poll_seconds") {
            config->interval_seconds = std::atoi(value.c_str());
        }
    }

    while (!config->server_url.empty() && config->server_url[config->server_url.size() - 1] == '/') {
        config->server_url.erase(config->server_url.size() - 1);
    }
    if (config->server_url.empty() || config->token.empty()) {
        *error = "Configuration must contain server_url and token.";
        return false;
    }
    if (config->interval_seconds < 60) {
        config->interval_seconds = 60;
    }
    return true;
}

static void draw_message(const char* title, const char* body)
{
    const int width = ScreenWidth();
    const int height = ScreenHeight();
    ClearScreen();
    DrawRect(10, 10, width - 20, height - 20, BLACK);

    if (title_font != NULL) {
        SetFont(title_font, BLACK);
        DrawTextRect(30, 50, width - 60, 50, title, ALIGN_CENTER);
    }
    if (body_font != NULL) {
        SetFont(body_font, BLACK);
        DrawTextRect(30, 130, width - 60, height - 220, body,
                     ALIGN_CENTER | VALIGN_MIDDLE);
        DrawTextRect(30, height - 90, width - 60, 40,
                     "Press Back to exit.", ALIGN_CENTER);
    }
    FullUpdate();
}

static bool draw_image(const char* path)
{
    ibitmap* picture = LoadJPEG(path, ScreenWidth(), ScreenHeight(), 100, 100, 1);
    if (picture == NULL) {
        return false;
    }

    const int x = (ScreenWidth() - picture->width) / 2;
    const int y = (ScreenHeight() - picture->height) / 2;
    ClearScreen();
    DrawBitmap(x, y, picture);
    FullUpdate();
    std::free(picture);
    image_is_visible = true;
    return true;
}

static void schedule_poll(int delay_seconds);

static void finish_poll()
{
    NetDisconnect();
    WiFiPower(0);
    poll_in_progress = false;
    schedule_poll(poll_seconds);
}

static bool download_revision(const std::string& url, std::string* revision)
{
    int size = 0;
    void* response = QuickDownload(url.c_str(), &size, DOWNLOAD_TIMEOUT_SECONDS);
    if (response == NULL || size <= 0 || size > 256) {
        std::free(response);
        return false;
    }
    revision->assign(static_cast<const char*>(response), size);
    std::free(response);
    *revision = trim(*revision);
    return !revision->empty();
}

static bool download_image(const std::string& url)
{
    int size = 0;
    void* response = QuickDownload(url.c_str(), &size, DOWNLOAD_TIMEOUT_SECONDS);
    if (response == NULL || size < 4 || size > MAX_IMAGE_BYTES) {
        std::free(response);
        return false;
    }

    const unsigned char* bytes = static_cast<const unsigned char*>(response);
    const bool is_jpeg = bytes[0] == 0xff && bytes[1] == 0xd8 &&
                         bytes[size - 2] == 0xff && bytes[size - 1] == 0xd9;
    const bool written = is_jpeg && write_binary_file(TEMP_IMAGE_PATH, response, size);
    std::free(response);
    return written;
}

static void poll_server()
{
    if (poll_in_progress) {
        return;
    }
    poll_in_progress = true;

    Config config;
    std::string error;
    if (!load_config(&config, &error)) {
        if (!image_is_visible) {
            draw_message("Setup required", error.c_str());
        }
        poll_seconds = DEFAULT_POLL_SECONDS;
        poll_in_progress = false;
        schedule_poll(poll_seconds);
        return;
    }
    poll_seconds = config.interval_seconds;

    WiFiPower(1);
    NetConnect2(NULL, 0);
    iv_netinfo* network = NetInfo();
    if (network == NULL || !network->connected) {
        finish_poll();
        return;
    }

    const std::string query = "?token=" + url_encode(config.token);
    std::string remote_revision;
    if (!download_revision(config.server_url + "/api/revision" + query,
                           &remote_revision)) {
        finish_poll();
        return;
    }

    std::string local_revision;
    read_text_file(REVISION_PATH, &local_revision);
    if (remote_revision == local_revision) {
        finish_poll();
        return;
    }

    if (download_image(config.server_url + "/api/image" + query)) {
        ibitmap* validation = LoadJPEG(TEMP_IMAGE_PATH, ScreenWidth(), ScreenHeight(), 100, 100, 1);
        if (validation != NULL) {
            std::free(validation);
            if (std::rename(TEMP_IMAGE_PATH, IMAGE_PATH) == 0) {
                write_text_file(REVISION_PATH, remote_revision);
                draw_image(IMAGE_PATH);
            }
        }
        std::remove(TEMP_IMAGE_PATH);
    }
    finish_poll();
}

static void poll_timer()
{
    poll_server();
}

static void schedule_poll(int delay_seconds)
{
    ClearTimerByName(POLL_TIMER);
    SetHardTimer(POLL_TIMER, poll_timer, delay_seconds * 1000);
}

static int event_handler(int type, int par1, int par2)
{
    (void)par2;
    switch (type) {
        case EVT_INIT:
            title_font = OpenFont("LiberationSans", 28, 1);
            body_font = OpenFont("LiberationSans", 20, 0);
            mkdir(IMAGE_DIR, 0755);
            if (!draw_image(IMAGE_PATH)) {
                draw_message("PocketBook Frame", "Waiting for the first drawing...");
            }
            schedule_poll(1);
            return 1;

        case EVT_SHOW:
            if (!image_is_visible) {
                draw_image(IMAGE_PATH);
            }
            return 1;

        case EVT_KEYPRESS:
            if (par1 == IV_KEY_BACK) {
                CloseApp();
                return 1;
            }
            return 0;

        case EVT_EXIT:
            ClearTimerByName(POLL_TIMER);
            NetDisconnect();
            WiFiPower(0);
            if (title_font != NULL) {
                CloseFont(title_font);
                title_font = NULL;
            }
            if (body_font != NULL) {
                CloseFont(body_font);
                body_font = NULL;
            }
            return 1;

        default:
            return 0;
    }
}

int main()
{
    OpenScreen();
    SetOrientation(0);
    InkViewMain(event_handler);
    return 0;
}
