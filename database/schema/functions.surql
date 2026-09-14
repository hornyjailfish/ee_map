# функция для создания ребер от Q0 к другим автоматам в щите (по умолчанию)
DEFINE FUNCTION OVERWRITE fn::default_relation($board: record<boards>) {
    let $list = SELECT VALUE id FROM breakers WHERE board = $board.id AND name != "Q0";
    let $root = SELECT VALUE id FROM ONLY breakers WHERE board = $board.id AND name = "Q0" LIMIT 1;

    FOR $out IN $list {
        INSERT RELATION IGNORE INTO connects {
            in: $root,
            out: $out
        };
    };
};

# функция для получения id щита по имени и id комнаты
DEFINE FUNCTION OVERWRITE fn::get_board_from_room($name: string, $room: { id: record<electric_rooms> }) -> record<boards> {
    RETURN SELECT VALUE id FROM ONLY boards WHERE name = $name AND room = $room.id LIMIT 1;
};
